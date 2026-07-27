export type ControlOptions = {
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  name?: string;
  placeholder?: string;
  required?: boolean;
  value?: string;
};

export function applyControlOptions(
  control: HTMLInputElement | HTMLTextAreaElement,
  options: ControlOptions,
) {
  if (options.ariaLabel) control.setAttribute("aria-label", options.ariaLabel);
  if (options.name) control.name = options.name;
  if (options.placeholder) control.placeholder = options.placeholder;
  control.disabled = Boolean(options.disabled);
  control.required = Boolean(options.required);
}
