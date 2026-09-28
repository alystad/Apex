import StatRow from "@/components/ui/StatRow";

type FotmobCompareRowProps = {
  label: string;
  away: number;
  home: number;
  lowerIsBetter?: boolean;
  format?: (value: number) => string;
};

export default function FotmobCompareRow(props: FotmobCompareRowProps) {
  return <StatRow {...props} />;
}
