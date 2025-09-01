import * as d3 from "d3";
import { countryToISO3 } from "./isoMap.js";

// --- SVG setup
const svg = d3.select("#map");
const width = +svg.node().getBoundingClientRect().width;
const height = +svg.node().getBoundingClientRect().height;

let worldData, happinessData, projection, path;
let selectedCountry = null; // Store clicked country

// --- Tooltip
const tooltip = d3.select("body")
    .append("div")
    .attr("class", "tooltip")
    .style("position", "absolute")
    .style("padding", "5px 10px")
    .style("background", "rgba(0,0,0,0.7)")
    .style("color", "#fff")
    .style("border-radius", "4px")
    .style("pointer-events", "none")
    .style("opacity", 0);

// --- Load CSV + GeoJSON and normalize ISO3 codes
async function loadData() {
    // --- Load CSV (semicolon-delimited)
    const happiness = await d3.dsv(";", "/data/data_happinessreport.csv", d => {
        const countryName = d["Country namegive"] || d["Country name"] || d.Country;
        const country = countryName ? countryName.trim() : null;

        return {
            country,
            year: +d.Year,
            rank: +d.Rank,
            ladder: +d["Ladder score"]
        };
    });

    // --- Load GeoJSON
    const world = await d3.json("/data/world.geo.json");

    // --- Map GeoJSON names to ISO3
    const unmatchedGeo = [];
    world.features.forEach(feature => {
        const name = feature.properties.name ? feature.properties.name.trim() : null;
        const iso = name ? (countryToISO3[name] || countryToISO3[name.replace(/\./g, '').replace(/['’]/g, "'")] || null) : null;

        if (iso) {
            feature.properties.iso_a3 = iso;
        } else if (name) {
            unmatchedGeo.push(name);
        }
    });

    if (unmatchedGeo.length) {
        console.warn("Countries in GeoJSON not in isoMap:", [...new Set(unmatchedGeo)]);
    }

    // --- Map CSV countries to ISO3
    happiness.forEach(d => {
        d.iso3 = d.country ? countryToISO3[d.country] || null : null;
    });

    // --- Check for unmatched CSV countries
    const missingCSV = happiness
        .filter(d => !d.iso3)
        .map(d => d.country)
        .filter(Boolean);

    if (missingCSV.length) {
        console.warn("Countries in CSV not in isoMap (will be ignored):", [...new Set(missingCSV)]);
    }

    // --- Filter happiness data to only those with ISO3 and present in GeoJSON
    const geoISOSet = new Set(world.features.map(f => f.properties.iso_a3).filter(Boolean));
    const filteredHappiness = happiness.filter(d => d.iso3 && geoISOSet.has(d.iso3));

    console.log("World features loaded:", world.features.length);

    return { happiness: filteredHappiness, world };
}

// --- Color scale for rank (low rank → red, high rank → green)
const colorScale = d3.scaleSequential()
    .interpolator(d3.interpolateRdYlGn)
    .domain([100, 1]); // rank 1 = green, rank 100 = red

// --- Draw or update map for a given year
function drawMap(year) {
    const yearData = new Map(
        happinessData
            .filter(d => d.year === year)
            .map(d => [d.iso3, d.rank])
    );

    const countries = svg.selectAll("path.country").data(worldData.features, d => d.properties.iso_a3);

    countries.enter()
        .append("path")
        .attr("class", "country")
        .merge(countries)
        .attr("d", path)
        .attr("fill", d => {
            const rank = yearData.get(d.properties.iso_a3);
            return rank ? colorScale(rank) : "#000";
        })
        .attr("stroke", "#aaa")
        .attr("stroke-width", 0.5)
        .on("click", (event, d) => {
            selectedCountry = d.properties.name;
            console.log(`Selected country: ${selectedCountry}`);
            showBreadcanFactor(selectedCountry);
        })
        .on("mouseover", (event, d) => {
            tooltip.style("opacity", 1)
                .html(d.properties.name);
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

// Placeholder
function showBreadcanFactor(country) {
    console.log(`Implement breadcan factor for: ${country}`);
}

// --- Load data and initialize map + slider
loadData().then(data => {
    worldData = data.world;
    happinessData = data.happiness;

    // --- Initialize projection now that we have GeoJSON
    projection = d3.geoNaturalEarth1().fitSize([width, height], worldData);
    path = d3.geoPath().projection(projection);

    drawMap(2024); // Initial year

    // Slider event
    d3.select("#yearSlider").on("input", function () {
        const year = +this.value;
        d3.select("#yearLabel").text(year);
        drawMap(year);
    });
});
