// Factory of the Exporter strategy: one exporter per format. The paperback PDF
// (a later addition) will be registered here without touching the callable.

import { DocxExporter } from './DocxExporter';
import { EpubExporter } from './EpubExporter';
import type { Exporter, ExportFormat } from './types';

const EXPORTERS: Record<ExportFormat, () => Exporter> = {
  epub: () => new EpubExporter(),
  docx: () => new DocxExporter(),
};

export function createExporter(format: ExportFormat): Exporter {
  return EXPORTERS[format]();
}
