import type { CSSProperties } from "react";
import { useLanguage } from "../../../app/providers/LanguageProvider";
import { exactRatioPercent, formatETB, formatMonth, formatQuantity } from "../utils/analytics-format";

const chartColors = ["#3157d5", "#18a87a", "#f2a93b", "#dc5f68", "#8959c8", "#168fa8", "#77849b"];

export interface ChartValue { label: string; value: string; display: string }

export function DonutChart({ title, data, emptyLabel, money = false }: { title: string; data: ChartValue[]; emptyLabel: string; money?: boolean }) {
  const { t } = useLanguage();
  const total = data.reduce((sum, row) => sum + (money ? decimalCents(row.value) : BigInt(Math.max(0, Number(row.value)))), 0n);
  const stops = data.reduce<{ current: bigint; values: string[] }>((state, row, index) => {
    const value = money ? decimalCents(row.value) : BigInt(Math.max(0, Number(row.value)));
    const start = total === 0n ? 0n : state.current * 10000n / total;
    const current = state.current + value;
    const end = total === 0n ? 0n : current * 10000n / total;
    return {
      current,
      values: [...state.values, `${chartColors[index % chartColors.length]} ${start / 100n}.${String(start % 100n).padStart(2, "0")}% ${end / 100n}.${String(end % 100n).padStart(2, "0")}%`],
    };
  }, { current: 0n, values: [] }).values;
  const style = { "--donut-stops": stops.join(", ") } as CSSProperties;
  return <section className="analytics-chart-card" aria-label={t(title)}>
    <h3>{t(title)}</h3>
    {total === 0n ? <div className="analytics-chart-empty">{t(emptyLabel)}</div> : <div className="analytics-donut-layout">
      <div className="analytics-donut" style={style} role="img" aria-label={t(title)}><span>{data.length}</span></div>
      <ul className="analytics-legend">{data.map((row, index) => <li key={row.label} title={row.display}>
        <i style={{ backgroundColor: chartColors[index % chartColors.length] }} aria-hidden="true" />
        <span>{t(row.label)}</span><strong>{row.display}</strong>
      </li>)}</ul>
    </div>}
  </section>;
}

function decimalCents(amount: string) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(amount);
  if (!match) return 0n;
  const cents = BigInt(match[2] ?? "0") * 100n + BigInt((match[3] ?? "").padEnd(2, "0").slice(0, 2));
  return match[1] === "-" ? -cents : cents;
}

export function MoneyBarChart({ title, data, emptyLabel }: { title: string; data: Array<{ label: string; amount: string }>; emptyLabel: string }) {
  const { t, language } = useLanguage();
  const max = data.reduce((largest, row) => decimalCents(row.amount) > largest ? decimalCents(row.amount) : largest, 0n);
  return <section className="analytics-chart-card" aria-label={t(title)}>
    <h3>{t(title)}</h3>
    {max === 0n ? <div className="analytics-chart-empty">{t(emptyLabel)}</div> : <div className="analytics-bars" role="list" aria-label={t(title)}>
      {data.map((row) => <div className="analytics-bar-column" key={row.label} role="listitem" title={`${t(row.label)}: ${formatETB(row.amount, language)}`}>
        <strong>{formatETB(row.amount, language)}</strong>
        <div className="analytics-bar-track"><span style={{ height: exactRatioPercent(row.amount, centsString(max)) }} /></div>
        <small>{formatMonth(row.label, language)}</small>
      </div>)}
    </div>}
  </section>;
}

function centsString(cents: bigint) { return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`; }

export function QuantityComparisonChart({ title, planned, completed, emptyLabel }: { title: string; planned: number; completed: number; emptyLabel: string }) {
  const { t, language } = useLanguage();
  const max = Math.max(planned, completed);
  return <section className="analytics-chart-card" aria-label={t(title)}>
    <h3>{t(title)}</h3>
    {max <= 0 ? <div className="analytics-chart-empty">{t(emptyLabel)}</div> : <div className="analytics-comparison">
      {[{ label: "Planned", value: planned, color: "#3157d5" }, { label: "Completed", value: completed, color: "#18a87a" }].map((row) => <div className="analytics-comparison-row" key={row.label}>
        <span>{t(row.label)}</span><div className="analytics-comparison-track"><i style={{ width: `${Math.floor(row.value * 100 / max)}%`, background: row.color }} /></div><strong>{formatQuantity(row.value, language)}</strong>
      </div>)}
    </div>}
  </section>;
}

export function MoneyComparisonChart({ title, data, emptyLabel, firstLabel, secondLabel }: { title: string; data: Array<{ label: string; first: string; second: string }>; emptyLabel: string; firstLabel: string; secondLabel: string }) {
  const { t, language } = useLanguage();
  const max = data.reduce((largest, row) => {
    const first = decimalCents(row.first), second = decimalCents(row.second);
    return first > largest ? (second > first ? second : first) : second > largest ? second : largest;
  }, 0n);
  return <section className="analytics-chart-card" aria-label={t(title)}>
    <h3>{t(title)}</h3>
    {max === 0n ? <div className="analytics-chart-empty">{t(emptyLabel)}</div> : <>
      <div className="analytics-chart-legend"><span><i className="legend-reconciled" />{t(firstLabel)}</span><span><i className="legend-provisional" />{t(secondLabel)}</span></div>
      <div className="analytics-bars analytics-bars-pair" role="list" aria-label={t(title)}>
        {data.map((row) => <div className="analytics-bar-column" key={row.label} role="listitem" title={`${t(row.label)}. ${t(firstLabel)}: ${formatETB(row.first, language)}. ${t(secondLabel)}: ${formatETB(row.second, language)}`}>
          <div className="analytics-paired-tracks"><span className="analytics-bar-reconciled" style={{ height: exactRatioPercent(row.first, centsString(max)) }} /><span className="analytics-bar-provisional" style={{ height: exactRatioPercent(row.second, centsString(max)) }} /></div>
          <small>{formatMonth(row.label, language)}</small>
        </div>)}
      </div>
    </>}
  </section>;
}

export function StackedStatusBars({ title, values, colors, emptyLabel }: { title: string; values: Array<{ label: string; value: number }>; colors?: string[]; emptyLabel: string }) {
  const { t } = useLanguage();
  const total = values.reduce((sum, item) => sum + item.value, 0);
  const gradient = values.reduce<{ previous: number; stops: string[] }>((state, item, index) => {
    const next = state.previous + (total ? item.value * 100 / total : 0);
    return {
      previous: next,
      stops: [...state.stops, `${colors?.[index] ?? chartColors[index % chartColors.length]} ${state.previous}% ${next}%`],
    };
  }, { previous: 0, stops: [] }).stops.join(", ");
  return <section className="analytics-chart-card" aria-label={t(title)}><h3>{t(title)}</h3>
    {total === 0 ? <div className="analytics-chart-empty">{t(emptyLabel)}</div> : <>
      <div className="analytics-status-band" style={{ background: `linear-gradient(90deg, ${gradient})` }} role="img" aria-label={`${t(title)}: ${values.map((item) => `${t(item.label)} ${item.value}`).join(", ")}`} />
      <ul className="analytics-legend">{values.map((item, index) => <li key={item.label} title={`${t(item.label)}: ${item.value}`}><i style={{ backgroundColor: colors?.[index] ?? chartColors[index % chartColors.length] }} /><span>{t(item.label)}</span><strong>{item.value}</strong></li>)}</ul>
    </>}
  </section>;
}
