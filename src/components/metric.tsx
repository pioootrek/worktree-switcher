export function Metric({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className={`truncate pt-0.5 ${mono ? "font-mono text-xs" : ""}`} title={value}>{value}</dd></div>;
}
