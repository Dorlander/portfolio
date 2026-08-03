/* Живая статистика: опрос /api/stats каждые 10 секунд. */
"use strict";

const STATUS_COLORS = {
    "Принят": "#8ecae6",
    "Входной контроль": "#219ebc",
    "В работе": "#ffb703",
    "Остановлен": "#e63946",
    "Выходной контроль": "#a78bfa",
    "К отгрузке": "#f4a261",
    "Отгружен": "#2a9d8f",
};

let statusChart = null;
let flowChart = null;

function tile(label, value, cls) {
    return `<div class="tile ${cls || ""}"><div class="tile-value">${value}</div><div class="tile-label">${label}</div></div>`;
}

async function refresh() {
    let s;
    try {
        const r = await fetch("/api/stats");
        s = await r.json();
    } catch (e) {
        document.getElementById("updated").textContent = "— нет связи, повтор...";
        return;
    }

    document.getElementById("updated").textContent = "обновлено " + s.generated_at;

    document.getElementById("tiles").innerHTML =
        tile("Всего изделий в учёте", s.total_qty) +
        tile("В работе (актов)", s.by_status["В работе"]) +
        tile("К отгрузке (актов)", s.by_status["К отгрузке"]) +
        tile("Отгружено (актов)", s.by_status["Отгружен"], "ok") +
        tile("Открытых дефектов", s.open_defects, s.open_defects ? "warn" : "") +
        tile("В изоляторе", s.isolator, s.isolator ? "warn" : "") +
        tile("На анализе (у разработчика)", s.analysis, s.analysis ? "warn" : "") +
        tile("Процент брака", s.defect_rate + "%", s.defect_rate > 5 ? "warn" : "") +
        tile("Просрочено отгрузок", s.overdue, s.overdue ? "bad" : "") +
        tile("Ср. цикл (дней)", s.avg_lead_days ?? "—") +
        (s.by_status["Остановлен"] ? tile("ОСТАНОВЛЕНО (масс. дефект)", s.by_status["Остановлен"], "bad") : "");

    const labels = s.statuses;
    const counts = labels.map((l) => s.by_status[l]);
    if (!statusChart) {
        statusChart = new Chart(document.getElementById("statusChart"), {
            type: "bar",
            data: { labels, datasets: [{ data: counts, backgroundColor: labels.map((l) => STATUS_COLORS[l]) }] },
            options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
        });
    } else {
        statusChart.data.datasets[0].data = counts;
        statusChart.update("none");
    }

    const days = s.shipped_by_day.map((d) => d.day.slice(8) + "." + d.day.slice(5, 7));
    const shipped = s.shipped_by_day.map((d) => d.qty);
    const accepted = s.accepted_by_day.map((d) => d.qty);
    if (!flowChart) {
        flowChart = new Chart(document.getElementById("flowChart"), {
            type: "line",
            data: {
                labels: days,
                datasets: [
                    { label: "Принято", data: accepted, borderColor: "#219ebc", backgroundColor: "#219ebc33", fill: true, tension: 0.3 },
                    { label: "Отгружено", data: shipped, borderColor: "#2a9d8f", backgroundColor: "#2a9d8f33", fill: true, tension: 0.3 },
                ],
            },
            options: { scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
        });
    } else {
        flowChart.data.labels = days;
        flowChart.data.datasets[0].data = accepted;
        flowChart.data.datasets[1].data = shipped;
        flowChart.update("none");
    }

    document.querySelector("#productTable tbody").innerHTML = s.by_product
        .map(
            (p) =>
                `<tr><td><b>${p.product}</b></td><td>${p.batches}</td><td>${p.quantity}</td>` +
                `<td>${p.repair || ""}</td><td>${p.shipped}</td></tr>`
        )
        .join("");

    document.getElementById("recent").innerHTML = s.recent
        .map((e) => `<li><b>${e.at}</b> — ${e.batch}: ${e.status}${e.by ? ` <span class="muted">(${e.by})</span>` : ""}</li>`)
        .join("");
}

refresh();
setInterval(refresh, 10000);
