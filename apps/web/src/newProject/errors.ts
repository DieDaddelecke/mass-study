import type { TFunction } from 'i18next';
import { ApiRequestError } from '../api/client';
import { ImportError } from './importSite';

/** Translated, user-facing message for API / import errors. */
export function errorMessage(t: TFunction<'newProject'>, e: unknown): string {
  if (e instanceof ImportError) return t(`import.errors.${e.code}`);
  if (e instanceof ApiRequestError) {
    const code = e.body?.error;
    if (code) return t(`errors.${code}`);
    if (e.status === 404) return t('errors.not_found');
    if (e.status >= 500) return t('errors.upstream_error');
    return t('errors.http', { status: e.status });
  }
  if (e instanceof TypeError) return t('errors.network');
  return t('errors.unknown');
}

export const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';
