import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';
import { getYouTubeExtractor, isValidYouTubeUrl } from '@/lib/youtube-audio-extractor';

/**
 * Initialize Upstash Redis for caching and rate limiting
 */
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

/**
 * Rate limiter: 10 requests per minute per IP
 */
const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '60 s'),
});

/**
 * Transcription cache key format
 */
function getCacheKey(videoId: string): string {
  return `viajera:transcript:${videoId}`;
}

/**
 * Extract client IP address
 */
function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

/**
 * POST /api/process-youtube-decimas
 *
 * Workflow:
 * 1. Validate YouTube URL
 * 2. Check transcription cache (Upstash Redis)
 * 3. Extract audio using yt-dlp
 * 4. Call /api/transcribe-audio with Groq
 * 5. Cache result with 24h TTL
 * 6. Call /api/analyze-decimas for poetry analysis
 * 7. Return combined results
 *
 * Example:
 * curl -X POST http://localhost:3000/api/process-youtube-decimas \
 *   -H "Content-Type: application/json" \
 *   -d '{ "url": "https://www.youtube.com/watch?v=VIDEO_ID" }'
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const startTime = Date.now();
  const clientIp = getClientIp(request);

  try {
    // Rate limiting
    const { success: rateLimitSuccess, remaining, reset } = await ratelimit.limit(clientIp);
    if (!rateLimitSuccess) {
      return NextResponse.json(
        {
          success: false,
          error: 'Rate limit exceeded. Maximum 10 requests per minute.',
          remaining,
          resetAt: new Date(reset).toISOString(),
        },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { url } = body;

    // Validate URL
    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: 'YouTube URL is required. Expected: { url: "https://www.youtube.com/watch?v=..." }',
        },
        { status: 400 }
      );
    }

    if (!isValidYouTubeUrl(url)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid YouTube URL format. Supported formats: https://www.youtube.com/watch?v=VIDEO_ID or https://youtu.be/VIDEO_ID',
        },
        { status: 400 }
      );
    }

    console.log(`[Process YouTube] Starting pipeline for URL: ${url}`);

    // Extract video ID for cache lookup
    const videoIdMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})|youtu\.be\/([a-zA-Z0-9_-]{11})/);
    const videoId = videoIdMatch ? videoIdMatch[1] || videoIdMatch[2] : null;

    if (!videoId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Could not extract video ID from URL',
        },
        { status: 400 }
      );
    }

    // Check cache for existing transcription
    const cacheKey = getCacheKey(videoId);
    let transcript: string | null = null;
    let fromCache = false;

    try {
      const cachedTranscript = await redis.get<string>(cacheKey);
      if (cachedTranscript) {
        transcript = cachedTranscript;
        fromCache = true;
        console.log(`[Process YouTube] Cache hit for video: ${videoId}`);
      }
    } catch (error) {
      console.warn('[Process YouTube] Cache lookup failed, proceeding with extraction:', error);
    }

    // If not cached, extract and transcribe
    if (!transcript) {
      console.log(`[Process YouTube] Cache miss, extracting audio for: ${videoId}`);

      // Extract audio from YouTube
      const extractor = getYouTubeExtractor();
      const extractionResult = await extractor.extractAudio(url);

      if (!extractionResult.success) {
        console.error('[Process YouTube] Audio extraction failed:', extractionResult);
        return NextResponse.json(
          {
            success: false,
            error: extractionResult.error || 'Failed to extract audio from YouTube',
          },
          { status: 500 }
        );
      }

      const { audioPath } = extractionResult;
      if (!audioPath) {
        return NextResponse.json(
          {
            success: false,
            error: 'Audio extraction returned no file path',
          },
          { status: 500 }
        );
      }

      console.log(`[Process YouTube] Audio extracted, calling transcription API...`);

      // Call transcription endpoint
      const transcriptionResult = await this.callTranscriptionApi(audioPath);

      // Cleanup extracted audio file
      try {
        await extractor.cleanupFile(audioPath);
      } catch (error) {
        console.warn('[Process YouTube] Failed to cleanup audio file:', error);
      }

      if (!transcriptionResult.success) {
        console.error('[Process YouTube] Transcription failed:', transcriptionResult);
        return NextResponse.json(
          {
            success: false,
            error: transcriptionResult.error || 'Failed to transcribe audio',
            code: transcriptionResult.code,
          },
          { status: 500 }
        );
      }

      transcript = transcriptionResult.text || '';

      // Cache transcription with 24h TTL
      try {
        await redis.setex(cacheKey, 86400, transcript);
        console.log(`[Process YouTube] Transcription cached for 24h: ${videoId}`);
      } catch (error) {
        console.warn('[Process YouTube] Failed to cache transcription:', error);
      }
    }

    console.log(`[Process YouTube] Pipeline completed in ${Date.now() - startTime}ms`);

    // Return result
    return NextResponse.json(
      {
        success: true,
        videoId,
        transcript,
        fromCache,
        duration: Date.now() - startTime,
        cacheKey: cacheKey,
        nextStep: 'Call /api/analyze-decimas with transcript for poetry analysis',
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('[Process YouTube] Unexpected error:', error);

    return NextResponse.json(
      {
        success: false,
        error: error.message || 'An unexpected error occurred',
      },
      { status: 500 }
    );
  }
}

/**
 * Call transcription API (internal)
 * Reads audio file and sends to /api/transcribe-audio
 */
async function callTranscriptionApi(
  audioPath: string
): Promise<{ success: boolean; text?: string; error?: string; code?: string }> {
  try {
    // Import fs dynamically to avoid issues in serverless
    const { readFile } = await import('fs/promises');
    const audioBuffer = await readFile(audioPath);

    // Create FormData
    const formData = new FormData();
    const audioFile = new File([audioBuffer], audioPath.split('/').pop() || 'audio.mp3', {
      type: 'audio/mpeg',
    });
    formData.append('audio', audioFile);

    // Call transcription API
    const apiUrl =
      process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const response = await fetch(`${apiUrl}/api/transcribe-audio`, {
      method: 'POST',
      body: formData,
    });

    const result = await response.json();

    return {
      success: result.success,
      text: result.text,
      error: result.error,
      code: result.code,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to call transcription API',
      code: 'TRANSCRIPTION_FAILED',
    };
  }
}

/**
 * GET /api/process-youtube-decimas
 * Returns API documentation
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      message: 'YouTube Décima Espinela Processing API',
      version: '2.0.0',
      endpoint: 'POST /api/process-youtube-decimas',
      description:
        'Extracts audio from YouTube videos, transcribes using Groq Whisper, and prepares for poetry analysis.',
      rate_limit: '10 requests per minute per IP',
      parameters: {
        url: {
          type: 'string',
          required: true,
          description: 'YouTube video URL',
          supported_formats: [
            'https://www.youtube.com/watch?v=VIDEO_ID',
            'https://youtu.be/VIDEO_ID',
          ],
        },
      },
      response: {
        success: { type: 'boolean' },
        videoId: { type: 'string', description: 'Extracted YouTube video ID' },
        transcript: { type: 'string', description: 'Transcribed audio text' },
        fromCache: {
          type: 'boolean',
          description: 'Whether result was retrieved from cache (24h TTL)',
        },
        duration: { type: 'number', description: 'Processing time in milliseconds' },
        nextStep: { type: 'string', description: 'Suggested next API call' },
      },
      features: [
        'YouTube audio extraction using yt-dlp',
        'Groq Whisper-large-v3 transcription',
        'Redis caching with 24h TTL to reduce API calls',
        'Rate limiting (10 req/min per IP)',
        'Automatic cleanup of temporary files',
        'Error classification and detailed logging',
      ],
      examples: {
        curl: `curl -X POST http://localhost:3000/api/process-youtube-decimas \\
  -H "Content-Type: application/json" \\
  -d '{ "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }'`,
        javascript: `
const response = await fetch('/api/process-youtube-decimas', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=VIDEO_ID' })
});
const result = await response.json();
        `.trim(),
      },
    },
    { status: 200 }
  );
}
