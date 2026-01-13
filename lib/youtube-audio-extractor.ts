import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';

const execAsync = promisify(exec);

/**
 * YouTube URL validation regex
 * Matches:
 * - https://www.youtube.com/watch?v=VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://www.youtube.com/watch?v=VIDEO_ID&t=TIME
 */
const YOUTUBE_URL_REGEX =
  /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})([&?].*)?$/;

/**
 * Extract video ID from YouTube URL
 */
export function extractYouTubeVideoId(url: string): string | null {
  const match = url.match(YOUTUBE_URL_REGEX);
  return match ? match[4] : null;
}

/**
 * Validate YouTube URL format
 */
export function isValidYouTubeUrl(url: string): boolean {
  return YOUTUBE_URL_REGEX.test(url);
}

/**
 * YouTube audio extraction configuration
 */
export interface ExtractorConfig {
  timeoutMs?: number; // Default: 5 minutes (300000ms)
  audioFormat?: 'mp3' | 'wav' | 'webm' | 'm4a'; // Default: 'mp3'
  audioQuality?: 'lowest' | 'low' | 'medium'; // Default: 'lowest' for speed
}

/**
 * Extraction result
 */
export interface ExtractionResult {
  success: boolean;
  audioPath?: string;
  filename?: string;
  duration?: number; // Execution time in ms
  error?: string;
  videoId?: string;
}

/**
 * YouTube audio extractor with format support and cleanup
 * Uses yt-dlp for reliable extraction with minimal dependencies
 */
export class YouTubeAudioExtractor {
  private config: Required<ExtractorConfig>;
  private tempFilesToCleanup: Set<string> = new Set();

  constructor(config: ExtractorConfig = {}) {
    this.config = {
      timeoutMs: config.timeoutMs || 300000, // 5 minutes
      audioFormat: config.audioFormat || 'mp3',
      audioQuality: config.audioQuality || 'lowest',
    };

    // Setup cleanup on process exit
    process.on('exit', () => this.cleanup());
    process.on('SIGINT', () => {
      this.cleanup();
      process.exit(130);
    });
  }

  /**
   * Extract audio from YouTube URL
   * Returns path to extracted audio file
   */
  async extractAudio(youtubeUrl: string): Promise<ExtractionResult> {
    const startTime = Date.now();

    try {
      // Validate URL
      if (!isValidYouTubeUrl(youtubeUrl)) {
        return {
          success: false,
          error: 'Invalid YouTube URL format',
          duration: Date.now() - startTime,
        };
      }

      const videoId = extractYouTubeVideoId(youtubeUrl);
      if (!videoId) {
        return {
          success: false,
          error: 'Could not extract video ID from URL',
          duration: Date.now() - startTime,
        };
      }

      // Generate temp file path
      const tempDir = tmpdir();
      const randomId = randomBytes(8).toString('hex');
      const filename = `viajera_${videoId}_${randomId}.${this.config.audioFormat}`;
      const audioPath = join(tempDir, filename);

      // Build yt-dlp command
      // Using -x (extract audio), -f (format), -q (quiet), -o (output template)
      const ytdlpCommand = this.buildYtdlpCommand(youtubeUrl, audioPath);

      console.log(`[YouTube Extract] Starting extraction for: ${videoId}`);
      console.log(`[YouTube Extract] Command: ${ytdlpCommand}`);

      // Execute with timeout
      const { stdout, stderr } = await this.executeWithTimeout(
        ytdlpCommand,
        this.config.timeoutMs
      );

      if (stderr && !stderr.includes('WARNING')) {
        console.warn(`[YouTube Extract] Warnings during extraction: ${stderr}`);
      }

      // Verify file was created
      if (!existsSync(audioPath)) {
        return {
          success: false,
          error: 'Audio extraction failed: Output file not created',
          videoId,
          duration: Date.now() - startTime,
        };
      }

      // Track for cleanup
      this.tempFilesToCleanup.add(audioPath);

      console.log(`[YouTube Extract] Successfully extracted to: ${audioPath}`);

      return {
        success: true,
        audioPath,
        filename,
        videoId,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      console.error('[YouTube Extract] Error:', error);
      return {
        success: false,
        error: error.message || 'Failed to extract audio from YouTube',
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Build yt-dlp command string
   * Optimized for speed with lowest bitrate selection
   */
  private buildYtdlpCommand(youtubeUrl: string, outputPath: string): string {
    // Use bestaudio[ext=mp3]/best format selection
    // Fallback chain: mp3 > webm > m4a > wav
    const formatMap: Record<string, string> = {
      mp3: 'bestaudio[ext=mp3]/best',
      webm: 'bestaudio[ext=webm]/best',
      m4a: 'bestaudio[ext=m4a]/best',
      wav: 'bestaudio[ext=wav]/best',
    };

    const format = formatMap[this.config.audioFormat] || 'bestaudio[ext=mp3]/best';
    const output = outputPath.replace(/'/g, "'\\''"); // Escape single quotes

    // Build command with proper escaping
    return [
      'yt-dlp',
      '-x', // Extract audio
      '--audio-format', this.config.audioFormat,
      '--audio-quality', this.config.audioQuality === 'lowest' ? '128' : '192',
      '-f', format,
      '--quiet',
      '--no-warnings',
      '-o', `'${output}'`,
      `'${youtubeUrl}'`,
    ].join(' ');
  }

  /**
   * Execute command with timeout
   */
  private executeWithTimeout(
    command: string,
    timeoutMs: number
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Command execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      execAsync(command, { maxBuffer: 10 * 1024 * 1024 }) // 10MB buffer
        .then((result) => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  /**
   * Clean up temporary audio file
   * Called automatically after transcription
   */
  async cleanupFile(audioPath: string): Promise<boolean> {
    try {
      if (existsSync(audioPath)) {
        await unlink(audioPath);
        this.tempFilesToCleanup.delete(audioPath);
        console.log(`[YouTube Extract] Cleaned up: ${audioPath}`);
        return true;
      }
      return false;
    } catch (error: any) {
      console.error(`[YouTube Extract] Cleanup error for ${audioPath}:`, error);
      return false;
    }
  }

  /**
   * Clean up all tracked temp files
   * Called on process exit
   */
  private async cleanup(): Promise<void> {
    const cleanupPromises = Array.from(this.tempFilesToCleanup).map((filepath) =>
      this.cleanupFile(filepath)
    );
    await Promise.all(cleanupPromises);
  }
}

// Singleton instance
let extractorInstance: YouTubeAudioExtractor;

/**
 * Get or create singleton extractor
 */
export function getYouTubeExtractor(
  config?: ExtractorConfig
): YouTubeAudioExtractor {
  if (!extractorInstance) {
    extractorInstance = new YouTubeAudioExtractor(config);
  }
  return extractorInstance;
}

export default getYouTubeExtractor;
