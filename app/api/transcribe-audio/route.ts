import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { getGroqClient, TranscriptionResponse, GroqErrorCode } from '@/lib/groq-client';

/**
 * Configuration
 */
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB (Groq limit)
const SUPPORTED_FORMATS = ['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm', 'audio/m4a'];
const SUPPORTED_EXTENSIONS = ['.mp3', '.mp4', '.wav', '.webm', '.m4a'];

/**
 * Audio file validation
 */
function validateAudioFile(
  file: File,
  mimeType?: string
): { valid: boolean; error?: string } {
  const filename = file.name.toLowerCase();

  // Check file extension
  const hasValidExtension = SUPPORTED_EXTENSIONS.some((ext) =>
    filename.endsWith(ext)
  );
  if (!hasValidExtension) {
    return {
      valid: false,
      error: `Unsupported audio format. Supported formats: ${SUPPORTED_EXTENSIONS.join(
        ', '
      )}`,
    };
  }

  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File size exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB. Your file: ${(
        file.size /
        1024 /
        1024
      ).toFixed(2)}MB`,
    };
  }

  // Check MIME type if provided
  if (mimeType && !SUPPORTED_FORMATS.includes(mimeType)) {
    return {
      valid: false,
      error: `Unsupported MIME type: ${mimeType}. Supported types: ${SUPPORTED_FORMATS.join(
        ', '
      )}`,
    };
  }

  return { valid: true };
}

/**
 * Format error response
 */
function errorResponse(
  error: string,
  code: GroqErrorCode,
  statusCode: number = 400
): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error,
      code,
    },
    { status: statusCode }
  );
}

/**
 * POST /api/transcribe-audio
 *
 * Accepts multipart/form-data with audio file
 * Transcribes using Groq Whisper API
 * Returns JSON with transcribed text
 *
 * Example curl:
 * curl -X POST http://localhost:3000/api/transcribe-audio \
 *   -F "audio=@audio.mp3"
 *
 * Response:
 * { "success": true, "text": "Transcribed Spanish text..." }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio');

    // Validate audio file is present
    if (!audioFile || !(audioFile instanceof File)) {
      return errorResponse(
        'No audio file provided. Please upload a file with key "audio"',
        'UNSUPPORTED_FORMAT',
        400
      );
    }

    // Validate audio file
    const validation = validateAudioFile(audioFile);
    if (!validation.valid) {
      return errorResponse(
        validation.error || 'Invalid audio file',
        validation.error?.includes('format') ? 'UNSUPPORTED_FORMAT' : 'FILE_TOO_LARGE',
        400
      );
    }

    // Convert File to Buffer
    const arrayBuffer = await audioFile.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);

    console.log(`[Transcribe API] Processing file: ${audioFile.name} (${audioFile.size} bytes)`);

    // Get Groq client and transcribe
    const groqClient = getGroqClient();
    const result = await groqClient.transcribe(
      audioBuffer,
      audioFile.name,
      audioFile.type || 'audio/mpeg'
    );

    // Handle transcription response
    if (!result.success) {
      console.error('[Transcribe API] Transcription failed:', result);

      // Determine HTTP status code based on error type
      let statusCode = 500;
      if (
        result.code === 'FILE_TOO_LARGE' ||
        result.code === 'UNSUPPORTED_FORMAT'
      ) {
        statusCode = 400;
      } else if (result.code === 'GROQ_AUTH_ERROR') {
        statusCode = 401;
      } else if (result.code === 'RATE_LIMIT') {
        statusCode = 429;
      }

      return errorResponse(
        result.error || 'Transcription failed',
        result.code || 'UNKNOWN_ERROR',
        statusCode
      );
    }

    console.log(
      `[Transcribe API] Successfully transcribed in ${result.duration}ms: ${result.text?.substring(
        0,
        100
      )}...`
    );

    return NextResponse.json(
      {
        success: true,
        text: result.text,
        duration: result.duration,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('[Transcribe API] Unexpected error:', error);

    return errorResponse(
      error.message || 'An unexpected error occurred during transcription',
      'UNKNOWN_ERROR',
      500
    );
  }
}

/**
 * GET /api/transcribe-audio
 * Returns API documentation
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      message: 'Groq Whisper Audio Transcription API',
      version: '1.0.0',
      endpoint: 'POST /api/transcribe-audio',
      description:
        'Transcribes audio files using Groq Whisper-large-v3 model. Supports audio files up to 25MB.',
      parameters: {
        audio: {
          type: 'File',
          required: true,
          description: 'Audio file to transcribe',
          supported_formats: SUPPORTED_EXTENSIONS,
          max_size_mb: MAX_FILE_SIZE / 1024 / 1024,
        },
      },
      response: {
        success: { type: 'boolean', description: 'Whether transcription succeeded' },
        text: { type: 'string', description: 'Transcribed text (if success=true)' },
        error: { type: 'string', description: 'Error message (if success=false)' },
        code: {
          type: 'string',
          description: 'Error code (if success=false)',
          possible_values: [
            'GROQ_AUTH_ERROR',
            'RATE_LIMIT',
            'FILE_TOO_LARGE',
            'UNSUPPORTED_FORMAT',
            'SERVER_ERROR',
            'TIMEOUT',
            'UNKNOWN_ERROR',
          ],
        },
        duration: { type: 'number', description: 'Processing time in milliseconds' },
      },
      examples: {
        curl: `curl -X POST http://localhost:3000/api/transcribe-audio -F "audio=@audio.mp3"`,
        javascript: `
const formData = new FormData();
formData.append('audio', audioFile);
const response = await fetch('/api/transcribe-audio', {
  method: 'POST',
  body: formData
});
const result = await response.json();
        `.trim(),
      },
    },
    { status: 200 }
  );
}
