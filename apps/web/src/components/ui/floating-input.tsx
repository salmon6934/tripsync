'use client';

/**
 * FloatingInput — a standardized text field with a "floating label".
 *
 * The label starts inside the field (acting like a placeholder). On focus, or
 * whenever the field holds a value, it smoothly slides up to the top-left edge
 * of the field's border, shrinks, and — while focused — recolors to the primary
 * theme token. The motion is driven purely by CSS transitions so it stays fluid
 * without any JS state.
 *
 * Implementation notes:
 * - The float trigger is CSS-only via Tailwind's `peer` + `:placeholder-shown`.
 *   The field therefore always carries a placeholder of a single space (" ") so
 *   `:placeholder-shown` is true only while it's empty. Any caller-provided
 *   `placeholder` is surfaced instead once the field is focused (the label has
 *   floated away by then, so the two never overlap).
 * - The floated label sits on top of the border and paints a `bg-card` strip so
 *   the hairline appears to break behind the text (classic outlined style).
 * - `size` picks the field metrics: `md` matches the tall auth inputs, `sm`
 *   matches the denser in-app form inputs. `multiline` renders a `<textarea>`
 *   with a top-aligned resting label.
 *
 * The floated-label class shapes (`peer-focus` / `peer-[:not(:placeholder-shown)]`)
 * are shared so any field built from this module floats identically. The inline
 * combobox in `LocationSearchInput` reuses `FLOATING_LABEL_FLOAT` for the same
 * reason.
 */

import { forwardRef } from 'react';
import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

type FieldSize = 'md' | 'sm';

const sizeStyles: Record<
  FieldSize,
  { field: string; labelResting: string; labelRestingMultiline: string }
> = {
  md: {
    field: 'h-12 rounded-[10px] px-4 text-base',
    labelResting: 'left-4 top-1/2 -translate-y-1/2 text-base',
    labelRestingMultiline: 'left-4 top-4 -translate-y-1/2 text-base',
  },
  sm: {
    field: 'rounded-lg px-3 py-2 text-sm',
    labelResting: 'left-3 top-1/2 -translate-y-1/2 text-sm',
    labelRestingMultiline: 'left-3 top-[1.15rem] -translate-y-1/2 text-sm',
  },
};

/** Base classes shared by every field (input or textarea). */
const FIELD_BASE =
  'peer w-full border border-border bg-card text-foreground shadow-sm outline-none transition-all duration-200 ease-in-out placeholder-transparent focus:placeholder-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary';

/** Base classes shared by every floating label. */
const LABEL_BASE =
  'pointer-events-none absolute rounded px-1 text-muted-foreground transition-all duration-200 ease-in-out';

/**
 * The floated state (field focused OR holding a value): the label slides to the
 * top border, shrinks, paints a card-colored strip so the border reads as cut,
 * and — while focused — turns the primary theme color. Exported so the bespoke
 * `LocationSearchInput` combobox can float its label identically.
 */
export const FLOATING_LABEL_FLOAT =
  'peer-focus:top-0 peer-focus:text-xs peer-focus:bg-card peer-focus:text-primary peer-[:not(:placeholder-shown)]:top-0 peer-[:not(:placeholder-shown)]:text-xs peer-[:not(:placeholder-shown)]:bg-card';

type CommonProps = {
  /** Text shown as the floating label (and the accessible name). */
  label: string;
  /** Stable id linking the label to the field; falls back to `name`. */
  id?: string;
  /** Hint revealed inside the field once it's focused. */
  placeholder?: string;
  /** Field metrics: `md` = tall (auth), `sm` = dense (in-app forms). */
  size?: FieldSize;
  /** Extra classes applied to the wrapping element. */
  wrapperClassName?: string;
};

type InputOnlyProps = CommonProps & {
  multiline?: false;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'placeholder' | 'size'>;

type TextareaProps = CommonProps & {
  multiline: true;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'placeholder'>;

export type FloatingInputProps = InputOnlyProps | TextareaProps;

export const FloatingInput = forwardRef<
  HTMLInputElement | HTMLTextAreaElement,
  FloatingInputProps
>(function FloatingInput(props, ref) {
  const {
    label,
    id,
    name,
    placeholder,
    size = 'md',
    multiline,
    className,
    wrapperClassName,
    ...rest
  } = props as CommonProps & {
    name?: string;
    multiline?: boolean;
    className?: string;
  } & Record<string, unknown>;

  const inputId = id ?? name;
  const styles = sizeStyles[size];

  return (
    <div className={cn('relative', wrapperClassName)}>
      {multiline ? (
        <textarea
          ref={ref as React.Ref<HTMLTextAreaElement>}
          id={inputId}
          name={name}
          // A non-empty placeholder keeps `:placeholder-shown` false; it's hidden
          // by `placeholder-transparent` and the real hint fades in on focus.
          placeholder={placeholder ?? ' '}
          className={cn(FIELD_BASE, styles.field, className)}
          {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)}
        />
      ) : (
        <input
          ref={ref as React.Ref<HTMLInputElement>}
          id={inputId}
          name={name}
          placeholder={placeholder ?? ' '}
          className={cn(FIELD_BASE, styles.field, className)}
          {...(rest as InputHTMLAttributes<HTMLInputElement>)}
        />
      )}
      <label
        htmlFor={inputId}
        className={cn(
          LABEL_BASE,
          multiline ? styles.labelRestingMultiline : styles.labelResting,
          FLOATING_LABEL_FLOAT,
        )}
      >
        {label}
      </label>
    </div>
  );
});
