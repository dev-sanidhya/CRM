"use client";

/** A select that saves as soon as it changes: no separate Update button. */
export function AutoSubmitSelect({
  action,
  name,
  defaultValue,
  options,
  label,
}: {
  action: (formData: FormData) => void;
  name: string;
  defaultValue: string;
  options: { value: string; label: string }[];
  label: string;
}) {
  return (
    <form action={action}>
      <label className="block">
        <span className="mb-1 block text-xs text-faint">{label}</span>
        <select
          name={name}
          defaultValue={defaultValue}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    </form>
  );
}
