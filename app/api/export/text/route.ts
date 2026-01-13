import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

interface ExportRequest {
  videoId?: string;
  title?: string;
  decimas?: Array<{
    text: string;
    rhymeScheme?: string;
    syllables?: number[];
  }>;
  analysis?: {
    summary?: string;
    historicalContext?: string;
    themes?: string[];
  };
  metadata?: {
    author?: string;
    date?: string;
    source?: string;
  };
}

/**
 * POST /api/export/text
 * 
 * Generates plain text export of décima analysis
 * 
 * Body:
 * {
 *   "title": "Mi Análisis",
 *   "decimas": [...],
 *   "analysis": {...},
 *   "metadata": {...}
 * }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: ExportRequest = await request.json();

    if (!body.decimas || body.decimas.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'No décimas provided for export',
        },
        { status: 400 }
      );
    }

    // Build text output
    const lines: string[] = [];
    const separator = '='.repeat(70);
    const thinSeparator = '-'.repeat(70);

    // Title
    const title = body.title || 'ANÁLISIS DE DÉCIMA ESPINELA';
    lines.push(separator);
    lines.push(title.toUpperCase());
    lines.push(separator);
    lines.push('');

    // Metadata
    if (body.metadata) {
      if (body.metadata.author) {
        lines.push(`Autor: ${body.metadata.author}`);
      }
      if (body.metadata.date) {
        lines.push(`Fecha: ${body.metadata.date}`);
      }
      if (body.metadata.source) {
        lines.push(`Fuente: ${body.metadata.source}`);
      }
      lines.push('');
      lines.push(thinSeparator);
      lines.push('');
    }

    // Décimas
    body.decimas.forEach((decima, index) => {
      lines.push(`DÉCIMA ${index + 1}`);
      lines.push(thinSeparator);
      lines.push('');
      
      // Split text into verses (lines)
      const verses = decima.text
        .split('\n')
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
      
      verses.forEach((verse) => {
        lines.push(verse);
      });
      lines.push('');

      // Rhyme scheme
      if (decima.rhymeScheme) {
        lines.push(`Esquema de rima: ${decima.rhymeScheme}`);
        lines.push('');
      }

      // Syllable count
      if (decima.syllables && decima.syllables.length > 0) {
        lines.push(`Sílabas por verso: ${decima.syllables.join(', ')}`);
        lines.push('');
      }

      lines.push('');
    });

    // Analysis section
    if (body.analysis) {
      lines.push(separator);
      lines.push('ANÁLISIS');
      lines.push(separator);
      lines.push('');

      if (body.analysis.summary) {
        lines.push('RESUMEN');
        lines.push(thinSeparator);
        lines.push(body.analysis.summary);
        lines.push('');
      }

      if (body.analysis.historicalContext) {
        lines.push('CONTEXTO HISTÓRICO');
        lines.push(thinSeparator);
        lines.push(body.analysis.historicalContext);
        lines.push('');
      }

      if (body.analysis.themes && body.analysis.themes.length > 0) {
        lines.push('TEMAS IDENTIFICADOS');
        lines.push(thinSeparator);
        body.analysis.themes.forEach((theme, idx) => {
          lines.push(`${idx + 1}. ${theme}`);
        });
        lines.push('');
      }
    }

    // Footer
    lines.push('');
    lines.push(separator);
    lines.push('Generado por Viajera Digital');
    lines.push(`Fecha de exportación: ${new Date().toLocaleString('es-CU')}`);
    lines.push(separator);

    // Join all lines
    const textContent = lines.join('\n');

    // Return as text file
    return new NextResponse(textContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="analisis-decima-${Date.now()}.txt"`,
        'Content-Length': Buffer.byteLength(textContent, 'utf8').toString(),
      },
    });
  } catch (error: any) {
    console.error('[Text Export] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to generate text export',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/export/text
 * Returns API documentation
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      message: 'Plain Text Export API',
      version: '1.0.0',
      endpoint: 'POST /api/export/text',
      description: 'Generates plain text (.txt) export of décima espinela analysis results',
      parameters: {
        title: { type: 'string', required: false, description: 'Document title' },
        decimas: {
          type: 'array',
          required: true,
          description: 'Array of décima objects with text, rhymeScheme, syllables',
        },
        analysis: {
          type: 'object',
          required: false,
          description: 'Analysis results (summary, themes, context)',
        },
        metadata: {
          type: 'object',
          required: false,
          description: 'Document metadata (author, date, source)',
        },
      },
      response: {
        format: 'text/plain',
        encoding: 'utf-8',
        filename_pattern: 'analisis-decima-{timestamp}.txt',
      },
    },
    { status: 200 }
  );
}
