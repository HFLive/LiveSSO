"use client";

export function AdminSelectFilter({ name, label, value, options }: { name: string; label: string; value: string; options: Array<{ value: string; label: string }> }) {
  return <select name={name} aria-label={label} defaultValue={value} key={value} onChange={(event) => event.currentTarget.form?.requestSubmit()}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
}
