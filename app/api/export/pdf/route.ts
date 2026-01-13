import { NextRequest, NextResponse } from 'next/server';
import jsPDF from 'jspdf';

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
 * POST /api/export/pdf
 * 
 * Generates PDF export of décima analysis
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

    // Create PDF
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'letter',
    });

    // Configure fonts and styles
    pdf.setFont('helvetica');
    let yPosition = 20;
    const pageWidth = pdf.internal.pageSize.getWidth();
    const margin = 20;
    const contentWidth = pageWidth - 2 * margin;

    // Title
    pdf.setFontSize(20);
    pdf.setFont('helvetica', 'bold');
    const title = body.title || 'Análisis de Décima Espinela';
    pdf.text(title, margin, yPosition);
    yPosition += 15;

    // Metadata
    if (body.metadata) {
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      if (body.metadata.author) {
        pdf.text(`Autor: ${body.metadata.author}`, margin, yPosition);
        yPosition += 6;
      }
      if (body.metadata.date) {
        pdf.text(`Fecha: ${body.metadata.date}`, margin, yPosition);
        yPosition += 6;
      }
      if (body.metadata.source) {
        pdf.text(`Fuente: ${body.metadata.source}`, margin, yPosition);
        yPosition += 6;
      }
      yPosition += 5;
    }

    // Separator
    pdf.setDrawColor(200, 200, 200);
    pdf.line(margin, yPosition, pageWidth - margin, yPosition);
    yPosition += 10;

    // Décimas
    body.decimas.forEach((decima, index) => {
      // Check if need new page
      if (yPosition > 250) {
        pdf.addPage();
        yPosition = 20;
      }

      // Décima title
      pdf.setFontSize(14);
      pdf.setFont('helvetica', 'bold');
      pdf.text(`Décima ${index + 1}`, margin, yPosition);
      yPosition += 8;

      // Décima text
      pdf.setFontSize(11);
      pdf.setFont('helvetica', 'normal');
      const lines = pdf.splitTextToSize(decima.text, contentWidth);
      lines.forEach((line: string) => {
        if (yPosition > 270) {
          pdf.addPage();
          yPosition = 20;
        }
        pdf.text(line, margin, yPosition);
        yPosition += 6;
      });

      // Rhyme scheme
      if (decima.rhymeScheme) {
        yPosition += 3;
        pdf.setFontSize(9);
        pdf.setTextColor(100, 100, 100);
        pdf.text(`Esquema de rima: ${decima.rhymeScheme}`, margin, yPosition);
        pdf.setTextColor(0, 0, 0);
        yPosition += 6;
      }

      yPosition += 8;
    });

    // Analysis section
    if (body.analysis) {
      if (yPosition > 200) {
        pdf.addPage();
        yPosition = 20;
      }

      pdf.setFontSize(16);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Análisis', margin, yPosition);
      yPosition += 10;

      pdf.setFontSize(11);
      pdf.setFont('helvetica', 'normal');

      if (body.analysis.summary) {
        const summaryLines = pdf.splitTextToSize(body.analysis.summary, contentWidth);
        summaryLines.forEach((line: string) => {
          if (yPosition > 270) {
            pdf.addPage();
            yPosition = 20;
          }
          pdf.text(line, margin, yPosition);
          yPosition += 6;
        });
        yPosition += 5;
      }

      if (body.analysis.themes && body.analysis.themes.length > 0) {
        yPosition += 3;
        pdf.setFont('helvetica', 'bold');
        pdf.text('Temas:', margin, yPosition);
        yPosition += 6;
        pdf.setFont('helvetica', 'normal');
        body.analysis.themes.forEach((theme) => {
          if (yPosition > 270) {
            pdf.addPage();
            yPosition = 20;
          }
          pdf.text(`• ${theme}`, margin + 5, yPosition);
          yPosition += 6;
        });
      }
    }

    // Footer
    const totalPages = pdf.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      pdf.setPage(i);
      pdf.setFontSize(8);
      pdf.setTextColor(150, 150, 150);
      pdf.text(
        `Viajera Digital - Página ${i} de ${totalPages}`,
        pageWidth / 2,
        pdf.internal.pageSize.getHeight() - 10,
        { align: 'center' }
      );
    }

    // Generate PDF buffer
    const pdfBuffer = Buffer.from(pdf.output('arraybuffer'));

    // Return PDF
    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="analisis-decima-${Date.now()}.pdf"`,
        'Content-Length': pdfBuffer.length.toString(),
      },
    });
  } catch (error: any) {
    console.error('[PDF Export] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to generate PDF',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/export/pdf
 * Returns API documentation
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      message: 'PDF Export API',
      version: '1.0.0',
      endpoint: 'POST /api/export/pdf',
      description: 'Generates PDF export of décima espinela analysis results',
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
    },
    { status: 200 }
  );
}
