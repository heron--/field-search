import * as Popover from "@radix-ui/react-popover";
import type { PopoverPrimitives } from "./SearchInput";

/**
 * `PopoverPrimitives` built on `@radix-ui/react-popover`.
 *
 * `SearchInput` itself never imports `@radix-ui/react-popover` so that
 * consumers who supply their own `popoverComponents` never pay for it.
 * Import this from `field-search/react/radix-popover` — a separate entry
 * point — and pass it as `SearchInputProps.popoverComponents` to restore the
 * Radix-backed popover; doing so requires `@radix-ui/react-popover` to be
 * installed.
 */
export const radixPopoverPrimitives: PopoverPrimitives = {
  Root: Popover.Root,
  Anchor: Popover.Anchor,
  Portal: Popover.Portal,
  Content: Popover.Content,
};
