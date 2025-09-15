import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { countryToISO3 } from "./isoMap.js";

// ====== DOM refs ======
const svg = d3.select("#map");
const slider = d3.select("#yearSlider");
const yearLabel = d3.select("#yearLabel");
const titleEl = d3.select("#countryTitle");
const sparkWrap = d3.select("#sparkline");
const factorsWrap = d3.select("#factors");
const ladderTodayEl = d3.select("#ladderToday");
const emptyNote = d3.select("#emptyNote");

// Globals
let worldData, happinessData, projection, path;
let byISO = new Map();
let selectedISO = null;
let initialized = false;
//events
let eventsData = {};


const factorKeys = [
    { key: "gdp",        label: "GDP per capita",            csv: "Explained by: Log GDP per capita" },
    { key: "social",     label: "Social support",            csv: "Explained by: Social support" },
    { key: "healthy",    label: "Healthy life",              csv: "Explained by: Healthy life expectancy" },
    { key: "freedom",    label: "Freedom",                   csv: "Explained by: Freedom to make life choices" },
    { key: "generosity", label: "Generosity",                csv: "Explained by: Generosity" },
    { key: "corruption", label: "Corruption",                csv: "Explained by: Perceptions of corruption" },
];

const parseComma = (v) => {
    if (v === undefined || v === null || v === "") return null;
    const s = String(v).replace(",", ".").replace(/\s/g, "");
    const num = parseFloat(s);
    return isNaN(num) ? null : num;
};

const tooltip = d3.select("body").append("div").attr("class","tooltip");
const colorScale = d3.scaleSequential().interpolator(d3.interpolateRdYlGn).domain([100,1]);

async function loadData() {
    const happiness = await d3.dsv(";", "/data/data_happinessreport.csv", d => {
        const countryName = d["Country namegive"] || d["Country name"] || d.Country;
        const country = countryName ? countryName.trim() : null;
        const row = {
            country,
            year: +d.Year,
            rank: +d.Rank,
            ladder: parseComma(d["Ladder score"]),
        };
        factorKeys.forEach(f => { row[f.key] = parseComma(d[f.csv]); });
        return row;
    });

    const world = await d3.json("/data/world.geo.json");

    //historische Events laden
    eventsData = await d3.json("/data/events.json");

    // Map GeoJSON name -> ISO3 using provided dictionary
    world.features.forEach(f => {
        const name = f.properties.name ? f.properties.name.trim() : null;
        const iso = name ? (countryToISO3[name] || countryToISO3[name.replace(/\./g,'').replace(/[’']/g,"'")]) : null;
        f.properties.iso_a3 = iso || null;
    });

    // CSV countries -> ISO3
    happiness.forEach(d => { d.iso3 = d.country ? countryToISO3[d.country] || null : null; });

    // Keep only countries present in GeoJSON
    const geoISOSet = new Set(world.features.map(f => f.properties.iso_a3).filter(Boolean));
    const filtered = happiness.filter(d => d.iso3 && geoISOSet.has(d.iso3));

    // Group rows per country for quick lookup
    byISO = d3.group(filtered, d => d.iso3);

    // Global max per factor for consistent bar scaling
    const factorMax = Object.fromEntries(
        factorKeys.map(f => [f.key, d3.max(filtered, d => d[f.key] ?? 0) || 1])
    );

    return { world, filtered, factorMax };
}

let factorMaxByKey = {};

function drawMap(year) {
    const yearData = new Map(happinessData.filter(d => d.year === year).map(d => [d.iso3, d.rank]));

    const g = svg.select("g.map-layer");

    const countries = g.selectAll("path.country").data(worldData.features, d => d.properties.iso_a3);

    countries.enter().append("path")
        .attr("class","country")
        .merge(countries)
        .attr("d", path)
        .attr("fill", d => {
            const rank = yearData.get(d.properties.iso_a3);
            return rank ? colorScale(rank) : "#1e293b";
        })
        .attr("stroke", "#334155").attr("stroke-width", 0.5)
        .on("click", (event, d) => { selectedISO = d.properties.iso_a3; showCountryPanel(selectedISO, d.properties.name); })
        .on("mouseover", (event, d) => { tooltip.style("opacity", 1).html(d.properties.name); })
        .on("mousemove", (event) => { tooltip.style("left",(event.pageX+10)+"px").style("top",(event.pageY+10)+"px"); })
        .on("mouseout", () => { tooltip.style("opacity", 0); });

    countries.exit().remove();
}

function showCountryPanel(iso3, displayName) {
    if (!iso3 || !byISO.has(iso3)) return;

    const year = +slider.property("value");
    const rows = byISO.get(iso3).slice().sort((a,b) => d3.ascending(a.year,b.year));

    // exact year or closest previous
    let row = rows.find(r => r.year === year) || rows.slice().reverse().find(r => r.year <= year) || rows[rows.length - 1];

    titleEl.text(displayName);
    ladderTodayEl.text(row && row.ladder ? d3.format(".2f")(row.ladder) : "");

    // Sparkline
    sparkWrap.selectAll("*").remove();
    const w=300,h=80,m={t:8,r:8,b:18,l:28};
    const svgS = sparkWrap.append("svg").attr("width", w).attr("height", h);
    const x = d3.scaleLinear().domain(d3.extent(rows, d=>d.year)).range([m.l, w-m.r]);
    const y = d3.scaleLinear().domain([d3.min(rows, d=>d.ladder) ?? 0, d3.max(rows, d=>d.ladder) ?? 10]).nice().range([h-m.b, m.t]);
    const line = d3.line().x(d=>x(d.year)).y(d=>y(d.ladder));
    svgS.append("path").datum(rows.filter(d=>d.ladder!=null)).attr("fill","none").attr("stroke","#93c5fd").attr("stroke-width",1.6).attr("d", line);
    if (row) svgS.append("circle").attr("cx",x(row.year)).attr("cy",y(row.ladder)).attr("r",3).attr("fill","#34d399");

    const years = rows.map(d=>d.year);
    const ticks = years.length > 6 ? years.filter((_,i)=> i % Math.ceil(years.length/6) === 0) : years;
    svgS.selectAll("text.year").data(ticks).enter().append("text")
        .attr("class","year").attr("x",d=>x(d)).attr("y",h-2).attr("text-anchor","middle").attr("font-size",10).attr("fill","#94a3b8").text(d=>d);

    // Factors
    emptyNote.style("display","none");
    const values = factorKeys.map(f => ({ key:f.key, label:f.label, value: row[f.key] ?? 0, max: factorMaxByKey[f.key] ?? 1 }));
    const rowsSel = factorsWrap.selectAll(".factor-row").data(values, d=>d.key);
    const rowsEnter = rowsSel.enter().append("div").attr("class","factor-row");
    rowsEnter.append("div").attr("class","factor-label").text(d=>d.label);
    const barWrap = rowsEnter.append("div").attr("class","bar-wrap"); barWrap.append("div").attr("class","bar");
    rowsEnter.append("div").attr("class","value");
    const merged = rowsEnter.merge(rowsSel);
    merged.select(".bar").transition().duration(350).style("width", d => (d.value/(d.max||1))*100 + "%");
    merged.select(".value").text(d=> d3.format(".2f")(d.value));
    rowsSel.exit().remove();

    // Covid comparison chart
    drawCovidComparison(rows);

// Historical events
    const historyEl = d3.select("#history");
    historyEl.selectAll("*").remove();

    const activeYear = +slider.property("value");

    if (eventsData && eventsData[iso3]) {
        const entries = Object.entries(eventsData[iso3])
            .map(([y, arr]) => ({ y: +y, ev: arr }))
            .sort((a,b) => d3.descending(a.y, b.y));

        // optional: nur Jahre bis zum aktiven Jahr
        const filtered = entries.filter(e => e.y <= activeYear);
        const list = filtered.length ? filtered : entries; // <-- FEHLTE

        list.forEach(({ y, ev }) => {
            const isActive = (y === activeYear);
            const block = historyEl.append("div")
                .attr("class", "event-block" + (isActive ? " active" : "")); // <-- "class", nicht "calss"

            block.append("div")
                .attr("class", "event-year")
                .text(y);

            ev.forEach((txt, i) => {
                block.append("div")
                    .attr("class", "event-text" + (isActive && i === 0 ? " headline" : ""))
                    .text(txt);
            });
        });
    } else {
        historyEl.append("div").attr("class", "subtle").text("Keine Ereignisse hinterlegt.");
    }


}

// ---- Lazy init: starte Visualisierung erst, wenn #viz sichtbar wird ----
function initViz() {
    if (initialized) return;
    initialized = true;

    loadData().then(({ world, filtered, factorMax }) => {
        worldData = world;
        happinessData = filtered;
        factorMaxByKey = factorMax;

        const bbox = svg.node().getBoundingClientRect();
        const w = bbox.width, h = bbox.height;

        // Projektion + Pfad
        projection = d3.geoNaturalEarth1().fitSize([w,h], worldData);
        path = d3.geoPath().projection(projection);

        // ---- Zoom & Pan ----
        // 1) Layer-Gruppe anlegen (alle Länder liegen in dieser Gruppe)
        const g = svg.append("g").attr("class", "map-layer");

        // 2) Zoom konfigurieren: skaliert/verschiebt die Gruppe g
        const zoom = d3.zoom()
            .scaleExtent([1, 8])
            .on("zoom", (event) => {
                g.attr("transform", event.transform);
            });

        // 3) Zoom auf das SVG registrieren
        svg.call(zoom);

        // Erstes Rendern
        drawMap(+slider.property("value"));

        // Slider
        slider.on("input", function() {
            const year = +this.value;
            yearLabel.text(year);
            drawMap(year);
            if (selectedISO) {
                const f = worldData.features.find(f => f.properties.iso_a3 === selectedISO);
                showCountryPanel(selectedISO, f ? f.properties.name : selectedISO);
            }
        });
    });
}

// Intersection Observer, um erst bei Sichtbarkeit zu initialisieren
const vizSection = document.querySelector("#viz");
if ("IntersectionObserver" in window && vizSection) {
    const io = new IntersectionObserver((entries) => {
        entries.forEach(e => { if (e.isIntersecting) { initViz(); io.disconnect(); } });
    }, { threshold: 0.15 });
    io.observe(vizSection);
} else {
    // Fallback: init immediately
    initViz();
}

function drawCovidComparison(rows) {
    const container = d3.select("#covidChart");
    container.selectAll("*").remove(); // clear previous

    // Define pre/post covid years
    const preYears = rows.filter(r => r.year >= 2015 && r.year <= 2019);
    const postYears = rows.filter(r => r.year >= 2020);

    const preAvg = preYears.length ? d3.mean(preYears, r => r.ladder) : null;
    const postAvg = postYears.length ? d3.mean(postYears, r => r.ladder) : null;

    if (preAvg == null && postAvg == null) {
        container.append("p").text("No data available for this country.");
        return;
    }

    const data = [
        { period: "Pre-Covid (2015–2019)", value: preAvg },
        { period: "Post-Covid (2020+)", value: postAvg }
    ].filter(d => d.value != null);

    const w = 300, h = 150, m = { t: 20, r: 20, b: 40, l: 40 };
    const svg = container.append("svg").attr("width", w).attr("height", h);

    const x = d3.scaleBand().domain(data.map(d => d.period)).range([m.l, w - m.r]).padding(0.3);
    const y = d3.scaleLinear().domain([0, d3.max(data, d => d.value) || 1]).nice().range([h - m.b, m.t]);

    // Bars
    svg.selectAll("rect").data(data).enter()
        .append("rect")
        .attr("x", d => x(d.period))
        .attr("y", d => y(d.value))
        .attr("width", x.bandwidth())
        .attr("height", d => y(0) - y(d.value))
        .attr("fill", "#3b82f6");

    // Values on top
    svg.selectAll("text.value").data(data).enter()
        .append("text")
        .attr("class", "value")
        .attr("x", d => x(d.period) + x.bandwidth() / 2)
        .attr("y", d => y(d.value) - 5)
        .attr("text-anchor", "middle")
        .attr("fill", "#fff")
        .text(d => d3.format(".2f")(d.value));

    // X Axis
    svg.append("g")
        .attr("transform", `translate(0,${h - m.b})`)
        .call(d3.axisBottom(x))
        .selectAll("text")
        .style("font-size", "10px");

    // Y Axis
    svg.append("g")
        .attr("transform", `translate(${m.l},0)`)
        .call(d3.axisLeft(y).ticks(5));
}