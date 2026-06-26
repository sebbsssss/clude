// Adapter binding the @clude/ui MemoryExportPanel to the dashboard API client.
//
// The panel is backend-agnostic: it only knows the MemoryExportApi contract
// (preview / export / listArtifacts). This maps that contract onto the live,
// owner-scoped /v1/pmp/* endpoints via the shared `api` singleton, so the panel
// inherits the exact same Bearer-token auth and 401 auth-expiry handling as
// every other authenticated dashboard call.

import type {
  ExportRequest,
  ExportResult,
  ExportSelection,
  MemoryExportApi,
  PmpArtifact,
  SelectionPreview,
} from '@clude/ui';
import { api } from './api';

/**
 * Build the MemoryExportApi the panel expects. Stateless — the auth token and
 * base URL are held by the `api` singleton, which the auth layer keeps current.
 */
export function createPmpExportApi(): MemoryExportApi {
  return {
    preview: (selection: ExportSelection): Promise<SelectionPreview> =>
      api.pmpPreview(selection),
    export: (req: ExportRequest): Promise<ExportResult> => api.pmpExport(req),
    listArtifacts: (): Promise<PmpArtifact[]> => api.pmpListArtifacts(),
  };
}
