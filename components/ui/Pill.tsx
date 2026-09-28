import LiquidGlassPill from "@/components/ui/LiquidGlassPill";

type PillProps = {
  label: string;
  tone?: "neutral" | "live" | "success" | "warning" | "danger";
  fillColor?: string;
};

export default function Pill({ label, tone = "neutral", fillColor }: PillProps) {
  return <LiquidGlassPill label={label} tone={tone} fillColor={fillColor} />;
}
