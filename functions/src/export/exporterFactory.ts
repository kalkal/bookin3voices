// Factory della Strategy Exporter: un exporter per formato. Il PDF
// paperback (fase successiva) si registrerà qui senza toccare la
// callable.

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
