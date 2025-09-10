import * as d3 from "d3";
import { countryToISO3 } from "./isoMap.js";

// ========= DOM refs
const svg = d3.select("#map");
const width = +svg.node().getBoundingClientRect().width;
const height = +svg.node().getBoundingClientRect().height;

const slider = d3.select("#yearSlider");
const yearLabel = d3.select("#yearLabel");

const panel = d3.select("#panel");
const titleEl = d3.select("#countryTitle");
const sparkWrap = d3.select("#sparkline");
const factorsWrap = d3.select("#factors");
const ladderTodayEl = d3.select("#ladderToday");
const emptyNote = d3.select("#emptyNote");

// ========= Globals
let worldData, happinessData, projection, path;
let byISO = new Map(); // Map<string ISO3, Array of rows>
let selectedISO = null; // Store clicked country (ISO3)
const factorKeys = [
    { key: "gdp", label: "GDP per capita", csv: "Explained by: Log GDP per capita" },
    { key: "social", label: "Social support", csv: "Explained by: Social support" },
    { key: "healthy", label: "Healthy life", csv: "Explained by: Healthy life expectancy" },
    { key: "freedom", label: "Freedom", csv: "Explained by: Freedom to make life choices" },
    { key: "generosity", label: "Generosity", csv: "Explained by: Generosity" },
    { key: "corruption", label: "Corruption", csv: "Explained by: Perceptions of corruption" },
];

const parseComma = (v) => {
    if (v === undefined || v === null || v === "") return null;
    const s = String(v).replace(",", ".").replace(/\s/g, "");
    const num = parseFloat(s);
    return isNaN(num) ? null : num;
};

// ========= Tooltip
const tooltip = d3.select("body")
    .append("div")
    .attr("class", "tooltip");

// ========= Color scale for rank (low rank → red, high rank → green)
const colorScale = d3.scaleSequential()
    .interpolator(d3.interpolateRdYlGn)
    .domain([100, 1]); // rank 1 = green, rank 100 = red

// ========= Load CSV + GeoJSON, normalize ISO3, and pre-index
async function loadData() {
    // CSV (semicolon-delimited)
    const happiness = await d3.dsv(";", "/data/data_happinessreport.csv", d => {
        const countryName = d["Country namegive"] || d["Country name"] || d.Country;
        const country = countryName ? countryName.trim() : null;

        const row = {
            country,
            year: +d.Year,
            rank: +d.Rank,
            ladder: parseComma(d["Ladder score"]),
        };

        // map factors
        factorKeys.forEach(f => {
            row[f.key] = parseComma(d[f.csv]);
        });

        return row;
    });

    // GeoJSON
    const world = await d3.json("/data/world.geo.json");

    // Map GeoJSON names -> ISO3 using provided dictionary
    world.features.forEach(f => {
        const name = f.properties.name ? f.properties.name.trim() : null;
        const iso = name ? (countryToISO3[name] || countryToISO3[name.replace(/\./g, '').replace(/['’]/g, "'")] || null) : null;
        f.properties.iso_a3 = iso;
    });

    // CSV countries -> ISO3
    happiness.forEach(d => {
        d.iso3 = d.country ? countryToISO3[d.country] || null : null;
    });

    // Filter to countries that exist in GeoJSON and have ISO3
    const geoISOSet = new Set(world.features.map(f => f.properties.iso_a3).filter(Boolean));
    const filtered = happiness.filter(d => d.iso3 && geoISOSet.has(d.iso3));

    // Pre-index for fast lookup
    byISO = d3.group(filtered, d => d.iso3);

    // Domain maxima for each factor — for consistent bars
    const factorMax = Object.fromEntries(
        factorKeys.map(f => [f.key, d3.max(filtered, d => d[f.key] ?? 0) || 1])
    );

    return { world, filtered, factorMax };
}

let factorMaxByKey = {};
// ========= Draw or update the map for a given year
function drawMap(year) {
    const yearData = new Map(
        happinessData
            .filter(d => d.year === year)
            .map(d => [d.iso3, d.rank])
    );

    const countries = svg.selectAll("path.country")
        .data(worldData.features, d => d.properties.iso_a3);

    countries.enter()
        .append("path")
        .attr("class", "country")
        .merge(countries)
        .attr("d", path)
        .attr("fill", d => {
            const rank = yearData.get(d.properties.iso_a3);
            return rank ? colorScale(rank) : "#e0e3e7";
        })
        .attr("stroke", "#aaa")
        .attr("stroke-width", 0.5)
        .on("click", (event, d) => {
            // store ISO and show the panel for current slider year
            selectedISO = d.properties.iso_a3;
            showCountryPanel(selectedISO, d.properties.name);
        })
        .on("mouseover", (event, d) => {
            tooltip.style("opacity", 1).html(d.properties.name);
        })
        .on("mousemove", (event) => {
            tooltip
                .style("left", (event.pageX + 10) + "px")
                .style("top", (event.pageY + 10) + "px");
        })
        .on("mouseout", () => {
            tooltip.style("opacity", 0);
        });

    countries.exit().remove();
}

// ========= Country details panel
function showCountryPanel(iso3, displayName) {
    if (!iso3 || !byISO.has(iso3)) return;

    const year = +slider.property("value");
    const rows = byISO.get(iso3).slice().sort((a, b) => d3.ascending(a.year, b.year));

    // pick exact year or closest previous year
    let row = rows.find(r => r.year === year) || rows.slice().reverse().find(r => r.year <= year) || rows[rows.length - 1];

    // Header
    titleEl.text(displayName);
    ladderTodayEl.text(row && row.ladder ? d3.format(".2f")(row.ladder) : "");

    // Sparkline (ladder over years)
    sparkWrap.selectAll("*").remove();
    const w = 300, h = 80, m = { t: 8, r: 8, b: 18, l: 28 };
    const svgS = sparkWrap.append("svg").attr("width", w).attr("height", h);
    const x = d3.scaleLinear().domain(d3.extent(rows, d => d.year)).range([m.l, w - m.r]);
    const y = d3.scaleLinear().domain([d3.min(rows, d => d.ladder) ?? 0, d3.max(rows, d => d.ladder) ?? 10]).nice().range([h - m.b, m.t]);

    const line = d3.line()
        .x(d => x(d.year))
        .y(d => y(d.ladder));

    svgS.append("path")
        .datum(rows.filter(d => d.ladder != null))
        .attr("fill", "none")
        .attr("stroke", "#4b5563")
        .attr("stroke-width", 1.5)
        .attr("d", line);

    if (row) {
        svgS.append("circle")
            .attr("cx", x(row.year))
            .attr("cy", y(row.ladder))
            .attr("r", 3);
    }

    // x-axis (years, light)
    const years = rows.map(d => d.year);
    const ticks = years.length > 6 ? years.filter((_, i) => i % Math.ceil(years.length / 6) === 0) : years;
    svgS.selectAll("text.year")
        .data(ticks)
        .enter()
        .append("text")
        .attr("class", "year")
        .attr("x", d => x(d))
        .attr("y", h - 2)
        .attr("text-anchor", "middle")
        .attr("font-size", 10)
        .attr("fill", "#9aa0a6")
        .text(d => d);

    // Factors
    emptyNote.style("display", "none");
    const values = factorKeys.map(f => ({
        key: f.key,
        label: f.label,
        value: row[f.key] ?? 0,
        max: factorMaxByKey[f.key] ?? 1,
    }));

    const rowsSel = factorsWrap.selectAll(".factor-row").data(values, d => d.key);

    // ENTER
    const rowsEnter = rowsSel.enter().append("div").attr("class", "factor-row");
    rowsEnter.append("div").attr("class", "factor-label").text(d => d.label);
    const barWrap = rowsEnter.append("div").attr("class", "bar-wrap");
    barWrap.append("div").attr("class", "bar");
    rowsEnter.append("div").attr("class", "value");

    // UPDATE + ENTER
    const merged = rowsEnter.merge(rowsSel);
    merged.select(".bar")
        .transition().duration(350)
        .style("width", d => (d.value / (d.max || 1)) * 100 + "%");
    merged.select(".value").text(d => d3.format(".2f")(d.value));

    rowsSel.exit().remove();
}

// ========= Init
loadData().then(({ world, filtered, factorMax }) => {
    worldData = world;
    happinessData = filtered;
    factorMaxByKey = factorMax;

    // Projektion und Pfad, sobald GeoJSON da ist
    projection = d3.geoNaturalEarth1().fitSize([width, height], worldData);
    path = d3.geoPath().projection(projection);

    drawMap(+slider.property("value"));

    // Slider event
    slider.on("input", function () {
        const year = +this.value;
        yearLabel.text(year);
        drawMap(year);
        if (selectedISO) {
            // Detail-Panel an das neue Jahr anpassen
            const feature = worldData.features.find(f => f.properties.iso_a3 === selectedISO);
            const displayName = feature ? feature.properties.name : selectedISO;
            showCountryPanel(selectedISO, displayName);
        }
    });
});