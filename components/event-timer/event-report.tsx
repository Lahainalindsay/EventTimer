"use client";

import { Download } from "lucide-react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { exportRundownCSV, exportTimingReportCSV } from "@/lib/csv-export";
import { actualElapsedSeconds } from "@/lib/segment-history";
import type { EventData } from "@/lib/types";

interface EventReportProps {
  event: EventData;
}

function formatMinutes(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatVariance(totalSeconds: number | null) {
  if (totalSeconds === null) return "—";
  if (totalSeconds === 0) return "On time";
  const abs = Math.abs(totalSeconds);
  const minutes = Math.floor(abs / 60);
  const seconds = abs % 60;
  return `${totalSeconds > 0 ? "+" : "-"}${minutes}:${String(seconds).padStart(2, "0")}`;
}

function downloadCsv(filename: string, content: string) {
  const link = document.createElement("a");
  link.href = `data:text/csv;charset=utf-8,${encodeURIComponent(content)}`;
  link.download = filename;
  link.click();
}

export function EventReport({ event }: EventReportProps) {
  const plannedTotal = event.segments.reduce((sum, segment) => sum + segment.duration * 60, 0);
  const actualTotal = event.segmentRuns
    .map((run) => actualElapsedSeconds(run))
    .filter((value): value is number => value !== null)
    .reduce((sum, value) => sum + value, 0);
  const totalVariance = actualTotal ? actualTotal - plannedTotal : null;
  const chartData = event.segments.map((segment) => {
    const latestRun = event.segmentRuns
      .filter((run) => run.agenda_item_id === segment.id && run.ended_at !== null)
      .sort((left, right) => new Date(left.ended_at ?? 0).getTime() - new Date(right.ended_at ?? 0).getTime())
      .at(-1);
    const actual = latestRun ? actualElapsedSeconds(latestRun) : null;
    const variance = actual === null ? null : actual - segment.duration * 60;
    return {
      name: segment.title,
      planned: segment.duration * 60,
      actual: actual ?? 0,
      actualColor: variance === null ? "#8aa097" : variance > 0 ? "#ff5c52" : variance < 0 ? "#1e8a5b" : "#3578e5",
      hasActual: actual !== null,
      variance,
    };
  });
  const chartSummary = chartData.length
    ? `${chartData.filter((item) => item.hasActual).length} of ${chartData.length} segments have recorded timing history.`
    : "No segment timing history is available yet.";

  return (
    <section className="report-panel">
      <div className="workspace-heading report-header">
        <div>
          <div className="eyebrow">POST-EVENT REPORT</div>
          <h1>{event.name}</h1>
          <p>{event.date} · {event.venue}</p>
        </div>
        <div className="heading-actions print-hidden">
          <button className="button secondary" onClick={() => downloadCsv(`${event.name}-rundown.csv`, exportRundownCSV(event))}>
            <Download size={16} /> Export rundown CSV
          </button>
          <button
            className="button primary"
            onClick={() => downloadCsv(`${event.name}-timing-report.csv`, exportTimingReportCSV(event, event.segmentRuns))}
          >
            <Download size={16} /> Export timing CSV
          </button>
        </div>
      </div>

      <div className="report-summary">
        <div>
          <span>Planned total</span>
          <strong>{formatMinutes(plannedTotal)}</strong>
        </div>
        <div>
          <span>Actual total</span>
          <strong>{actualTotal ? formatMinutes(actualTotal) : "—"}</strong>
        </div>
        <div>
          <span>Variance</span>
          <strong className={totalVariance && totalVariance > 0 ? "danger" : totalVariance && totalVariance < 0 ? "green" : undefined}>
            {formatVariance(totalVariance)}
          </strong>
        </div>
      </div>

      <div className="report-table-wrap">
        <table className="report-table">
          <thead>
            <tr>
              <th>Segment</th>
              <th>Person</th>
              <th>Planned</th>
              <th>Actual</th>
              <th>Variance</th>
            </tr>
          </thead>
          <tbody>
            {event.segments.map((segment) => {
              const latestRun = event.segmentRuns
                .filter((run) => run.agenda_item_id === segment.id && run.ended_at !== null)
                .sort((left, right) => new Date(left.ended_at ?? 0).getTime() - new Date(right.ended_at ?? 0).getTime())
                .at(-1);
              const actual = latestRun ? actualElapsedSeconds(latestRun) : null;
              const hasActual = actual !== null;
              const variance = hasActual ? actual - segment.duration * 60 : null;
              return (
                <tr key={segment.id}>
                  <td>{segment.title}</td>
                  <td>{segment.person}</td>
                  <td>{formatMinutes(segment.duration * 60)}</td>
                  <td>{hasActual ? formatMinutes(actual) : "—"}</td>
                  <td className={variance && variance > 0 ? "danger" : variance && variance < 0 ? "green" : undefined}>
                    {formatVariance(variance)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="report-chart print:hidden" aria-label="Segment timing chart">
        <div className="report-chart-heading">
          <strong>Segment timing chart</strong>
          <p>{chartSummary}</p>
        </div>
        <div className="report-chart-frame">
          <ResponsiveContainer width="100%" height={Math.max(260, chartData.length * 52)}>
            <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 20, left: 20, bottom: 8 }}>
              <XAxis type="number" tickFormatter={(value) => formatMinutes(Number(value))} />
              <YAxis type="category" dataKey="name" width={140} />
              <Tooltip
                formatter={(value: number, name: string, item) => {
                  if (name === "actual" && !item.payload.hasActual) return ["—", "Actual"];
                  return [formatMinutes(Number(value)), name === "planned" ? "Planned" : "Actual"];
                }}
                labelFormatter={(label) => `Segment: ${label}`}
              />
              <Bar dataKey="planned" fill="#c8d0cb" radius={4} />
              <Bar dataKey="actual" radius={4}>
                {chartData.map((entry) => (
                  <Cell key={entry.name} fill={entry.actualColor} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}
