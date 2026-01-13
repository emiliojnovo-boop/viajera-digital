import Groq from 'groq-sdk';

/**
 * Error classification for Groq API responses
 */
export type GroqErrorCode = 
  | 'GROQ_AUTH_ERROR'
  | 'RATE_LIMIT'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FORMAT'
  | 'SERVER_ERROR'
  | 'TIMEOUT'
  | 'UNKNOWN_ERROR';

/**
 * Groq transcription response interface
 */
export interface TranscriptionResponse {
  success: boolean;
  text?: string;
  error?: string;
  code?: GroqErrorCode;
  duration?: number; // Execution time in ms
}

/**
 * Retry configuration
 */
interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

/**
 * Groq client singleton with retry logic and error classification
 */
class GroqClient {
  private client: Groq;
  private retryConfig: RetryConfig;

  constructor() {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error('GROQ_API_KEY environment variable is not set');
    }

    this.client = new Groq({ apiKey });
    this.retryConfig = {
      maxAttempts: 3,
      baseDelayMs: 1000,
      maxDelayMs: 10000,
    };
  }

  /**
   * Calculate exponential backoff delay
   */
  private getBackoffDelay(attempt: number): number {
    const delay = Math.min(
      this.retryConfig.baseDelayMs * Math.pow(2, attempt),
      this.retryConfig.maxDelayMs
    );
    // Add jitter (±20%)
    const jitter = delay * 0.2 * Math.random();
    return delay + (Math.random() > 0.5 ? jitter : -jitter);
  }

  /**
   * Classify error and return appropriate error code
   */
  private classifyError(error: any): GroqErrorCode {
    if (error instanceof Groq.APIError) {
      if (error.status === 401 || error.status === 403) {
        return 'GROQ_AUTH_ERROR';
      }
      if (error.status === 429) {
        return 'RATE_LIMIT';
      }
      if (error.status === 413) {
        return 'FILE_TOO_LARGE';
      }
      if (error.status && error.status >= 500) {
        return 'SERVER_ERROR';
      }
      if (error.message?.includes('unsupported') || error.message?.includes('format')) {
        return 'UNSUPPORTED_FORMAT';
      }
    }

    if (error.name === 'TimeoutError' || error.code === 'ECONNABORTED') {
      return 'TIMEOUT';
    }

    return 'UNKNOWN_ERROR';
  }

  /**
   * Transcribe audio file with Groq Whisper API
   * Implements retry logic with exponential backoff
   */
  async transcribe(
    audioBuffer: Buffer,
    filename: string,
    mimeType: string = 'audio/mpeg'
  ): Promise<TranscriptionResponse> {
    const startTime = Date.now();

    for (let attempt = 0; attempt < this.retryConfig.maxAttempts; attempt++) {
      try {
        // Create FormData-like object for Groq API
        const file = new File([audioBuffer], filename, { type: mimeType });

        // Call Groq Whisper API
        const transcription = await this.client.audio.transcriptions.create({
          file,
          model: 'whisper-large-v3',
          language: 'es', // Spanish language code
          temperature: 0, // Deterministic output
          response_format: 'json',
        });

        return {
          success: true,
          text: transcription.text,
          duration: Date.now() - startTime,
        };
      } catch (error: any) {
        const errorCode = this.classifyError(error);
        const isLastAttempt = attempt === this.retryConfig.maxAttempts - 1;

        // Log retry attempt
        console.warn(
          `Groq transcription attempt ${attempt + 1}/${this.retryConfig.maxAttempts} failed:`,
          {
            code: errorCode,
            message: error.message,
            status: error.status,
          }
        );

        // Don't retry on auth, unsupported format, or file size errors
        if (
          errorCode === 'GROQ_AUTH_ERROR' ||
          errorCode === 'UNSUPPORTED_FORMAT' ||
          errorCode === 'FILE_TOO_LARGE'
        ) {
          return {
            success: false,
            error: error.message || `Transcription failed: ${errorCode}`,
            code: errorCode,
            duration: Date.now() - startTime,
          };
        }

        // If last attempt, return error
        if (isLastAttempt) {
          return {
            success: false,
            error: error.message || `Transcription failed after ${this.retryConfig.maxAttempts} attempts`,
            code: errorCode,
            duration: Date.now() - startTime,
          };
        }

        // Wait before retrying
        const delayMs = this.getBackoffDelay(attempt);
        console.log(`Retrying in ${Math.round(delayMs)}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    return {
      success: false,
      error: 'Transcription failed: Max retry attempts exceeded',
      code: 'UNKNOWN_ERROR',
      duration: Date.now() - startTime,
    };
  }
}

// Singleton instance
let groqClientInstance: GroqClient;

/**
 * Get or create singleton Groq client
 */
export function getGroqClient(): GroqClient {
  if (!groqClientInstance) {
    groqClientInstance = new GroqClient();
  }
  return groqClientInstance;
}

export default getGroqClient;
