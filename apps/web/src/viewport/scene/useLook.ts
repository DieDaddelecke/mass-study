import { useResolvedTheme } from '../../theme/themeStore';
import { useViewportStore } from '../viewportStore';
import { lookSpec, type LookSpec } from './looks';

/** Look of the 3D view for the current theme. */
export function useLook(): LookSpec {
  const theme = useResolvedTheme();
  const look = useViewportStore((s) => s.look);
  return lookSpec(look, theme);
}
