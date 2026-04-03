Promise.all([
    d3.csv("AllSchool_17_22.csv"),
    d3.json("SCHOOLDISTRICTS_POLY.json")
]).then(function(files) {
    let csvData = files[0];
    let geoData = files[1];

    console.log("CSV rows:", csvData.length);
    console.log("Geo features:", geoData.features.length);
    console.log("First geo properties:", geoData.features[0].properties);

    makeMap(csvData, geoData);
}).catch(function(error) {
    console.log("Error loading files:", error);
});


// tooltip
let tooltip = d3.select("#tooltip")
    .style("position", "absolute")
    .style("background", "white")
    .style("padding", "10px")
    .style("border", "1px solid #ccc")
    .style("border-radius", "6px")
    .style("pointer-events", "none")
    .style("opacity", 0);


// svg
let width = 900;
let height = 700;

let svg = d3.select("#map-container")
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .style("background", "#f5f5f5");


// turn school code into district code
function getDistrictCodeFromSchoolCode(schoolCode) {
    let code = Number(schoolCode);

    if (isNaN(code)) {
        return null;
    }

    let districtCode = Math.floor(code / 10000);
    return String(districtCode).padStart(4, "0");
}


// clean district names for fallback matching
function cleanName(name) {
    if (!name) {
        return "";
    }

    return name
        .toLowerCase()
        .replace(/[-–]/g, " ")
        .replace(/public schools?/g, "")
        .replace(/school district/g, "")
        .replace(/district/g, "")
        .replace(/community school/g, "")
        .replace(/regional/g, "")
        .replace(/\s+/g, " ")
        .trim();
}


// draw legend
function drawLegend(colorScale, minRate, maxRate) {
    svg.selectAll(".legend-group").remove();

    let legendWidth = 240;
    let legendHeight = 16;
    let legendX = 40;
    let legendY = 40;

    let legendGroup = svg.append("g")
        .attr("class", "legend-group");

    let defs = svg.select("defs");
    if (defs.empty()) {
        defs = svg.append("defs");
    }

    defs.select("#legend-gradient").remove();

    let gradient = defs.append("linearGradient")
        .attr("id", "legend-gradient")
        .attr("x1", "0%")
        .attr("x2", "100%")
        .attr("y1", "0%")
        .attr("y2", "0%");

    let numStops = 20;

    for (let i = 0; i <= numStops; i++) {
        let t = i / numStops;
        let value = minRate + t * (maxRate - minRate);

        gradient.append("stop")
            .attr("offset", (t * 100) + "%")
            .attr("stop-color", colorScale(value));
    }

    legendGroup.append("text")
        .attr("x", legendX)
        .attr("y", legendY - 10)
        .style("font-size", "14px")
        .style("font-weight", "bold")
        .text("Graduation Rate");

    legendGroup.append("rect")
        .attr("x", legendX)
        .attr("y", legendY)
        .attr("width", legendWidth)
        .attr("height", legendHeight)
        .attr("fill", "url(#legend-gradient)")
        .attr("stroke", "#333")
        .attr("stroke-width", 0.5);

    let legendScale = d3.scaleLinear()
        .domain([minRate, maxRate])
        .range([legendX, legendX + legendWidth]);

    let legendAxis = d3.axisBottom(legendScale)
        .ticks(5)
        .tickFormat(function(d) {
            return d.toFixed(0) + "%";
        });

    legendGroup.append("g")
        .attr("transform", "translate(0," + (legendY + legendHeight) + ")")
        .call(legendAxis);
}


function makeMap(csvData, geoData) {

    // clean csv
    csvData.forEach(function(d) {
        d.year = parseFloat(d.year);
        d.gradRate = parseFloat(d["% Graduated"]);
        d.cohort = parseFloat(d["# in Cohort"]);

        d.econ = parseFloat(d["Economically Disadvantaged%"]);
        d.highNeeds = parseFloat(d["High Needs%"]);
        d.english = parseFloat(d["English Learners%"]);

        d.schoolCode = d["School Code"];
        d.org4 = getDistrictCodeFromSchoolCode(d.schoolCode);

        if (d["School Name"]) {
            d.district = d["School Name"].split(" - ")[0].trim();
            d.cleanDistrict = cleanName(d.district);
        } else {
            d.district = "";
            d.cleanDistrict = "";
        }
    });

    console.log("Metric parse check:",
        csvData.slice(0, 15).map(function(d) {
            return {
                school: d["School Name"],
                year: d.year,
                gradRate: d.gradRate,
                econ: d.econ,
                highNeeds: d.highNeeds,
                english: d.english
            };
        })
    );

    // keep rows with valid district code and year
    let gradData = csvData.filter(function(d) {
        return !isNaN(d.year) && d.org4 !== null;
    });

    console.log("Filtered rows:", gradData.length);
    console.log("Sample csv row:", gradData[0]);

    // unique years
    let years = [];
    gradData.forEach(function(d) {
        if (!years.includes(d.year)) {
            years.push(d.year);
        }
    });

    years.sort(function(a, b) {
        return a - b;
    });

    let yearSelect = d3.select("#yearSelect");

    yearSelect.selectAll("option").remove();

    yearSelect.selectAll("option")
        .data(years)
        .enter()
        .append("option")
        .attr("value", function(d) {
            return d;
        })
        .text(function(d) {
            return d;
        });

    let selectedYear = years[years.length - 1];
    yearSelect.property("value", selectedYear);

    // projected coordinates from MassGIS
    let projection = d3.geoIdentity()
        .reflectY(true)
        .fitSize([width, height], geoData);

    let path = d3.geoPath().projection(projection);

    updateMap(selectedYear);

    yearSelect.on("change", function() {
        selectedYear = +this.value;
        updateMap(selectedYear);
    });

    function updateMap(year) {

        let oneYearData = gradData.filter(function(d) {
            return d.year === year;
        });

        console.log("Rows for year", year, oneYearData.length);

        let districtSums = {};
        let districtInfo = {};

        oneYearData.forEach(function(d) {
            let code = d.org4;

            if (!districtSums[code]) {
                districtSums[code] = {
                    gradWeightedSum: 0,
                    gradCohortSum: 0,

                    econWeightedSum: 0,
                    econCount: 0,

                    highNeedsWeightedSum: 0,
                    highNeedsCount: 0,

                    englishWeightedSum: 0,
                    englishCount: 0
                };

                districtInfo[code] = {
                    districtName: d.district,
                    cleanDistrict: d.cleanDistrict
                };
            }

            if (!isNaN(d.gradRate) && !isNaN(d.cohort) && d.cohort > 0) {
                districtSums[code].gradWeightedSum += d.gradRate * d.cohort;
                districtSums[code].gradCohortSum += d.cohort;
            }

            if (!isNaN(d.econ)) {
                districtSums[code].econWeightedSum += d.econ;
                districtSums[code].econCount += 1;
            }

            if (!isNaN(d.highNeeds)) {
                districtSums[code].highNeedsWeightedSum += d.highNeeds;
                districtSums[code].highNeedsCount += 1;
            }

            if (!isNaN(d.english)) {
                districtSums[code].englishWeightedSum += d.english;
                districtSums[code].englishCount += 1;
            }
        });

        let districtData = {};

        for (let code in districtSums) {
            districtData[code] = {
                gradRate: districtSums[code].gradCohortSum > 0
                    ? districtSums[code].gradWeightedSum / districtSums[code].gradCohortSum
                    : NaN,

                econ: districtSums[code].econCount > 0
                    ? districtSums[code].econWeightedSum / districtSums[code].econCount
                    : NaN,

                highNeeds: districtSums[code].highNeedsCount > 0
                    ? districtSums[code].highNeedsWeightedSum / districtSums[code].highNeedsCount
                    : NaN,

                english: districtSums[code].englishCount > 0
                    ? districtSums[code].englishWeightedSum / districtSums[code].englishCount
                    : NaN,

                cohort: districtSums[code].gradCohortSum,
                districtName: districtInfo[code].districtName,
                cleanDistrict: districtInfo[code].cleanDistrict
            };
        }

        // fallback lookup by cleaned district name
        let districtDataByName = {};
        for (let code in districtData) {
            let cleanDistrict = districtData[code].cleanDistrict;
            if (cleanDistrict) {
                districtDataByName[cleanDistrict] = districtData[code];
            }
        }

        let gradRates = [];
        for (let code in districtData) {
            if (!isNaN(districtData[code].gradRate)) {
                gradRates.push(districtData[code].gradRate);
            }
        }

        let minRate = d3.min(gradRates);
        let maxRate = d3.max(gradRates);

        console.log("Min grad rate:", minRate);
        console.log("Max grad rate:", maxRate);

        let colorScale = d3.scaleSequential()
            .domain([minRate, maxRate])
            .interpolator(function(t) {
                return d3.interpolateViridis(1 - t);
            });

        drawLegend(colorScale, minRate, maxRate);

        svg.selectAll("path")
            .data(geoData.features)
            .join("path")
            .attr("d", path)
            .attr("fill", function(d) {
                let code = d.properties.ORG4CODE;
                let match = districtData[code];

                if (!match) {
                    let geoName = d.properties.DISTRICT_N;
                    let cleanGeoName = cleanName(geoName);
                    match = districtDataByName[cleanGeoName];
                }

                if (match && !isNaN(match.gradRate)) {
                    return colorScale(match.gradRate);
                } else {
                    return "#e6e6e6";
                }
            })
            .attr("stroke", "#444")
            .attr("stroke-width", 0.7)
            .on("mouseover", function(event, d) {
                d3.select(this)
                    .attr("stroke", "black")
                    .attr("stroke-width", 1.5);

                let code = d.properties.ORG4CODE;
                let geoName = d.properties.DISTRICT_N;
                let match = districtData[code];

                if (!match) {
                    let cleanGeoName = cleanName(geoName);
                    match = districtDataByName[cleanGeoName];
                }

                if (match) {
                    tooltip
                        .style("opacity", 1)
                        .html(
                            "<strong>" + geoName + "</strong><br>" +
                            "District Code: " + code + "<br>" +
                            "Year: " + year + "<br>" +
                            "Graduation Rate: " + (!isNaN(match.gradRate) ? match.gradRate.toFixed(1) + "%" : "N/A") + "<br>" +
                            "Total Cohort: " + (!isNaN(match.cohort) ? match.cohort : "N/A") + "<br>" +
                            "Economically Disadvantaged: " + (!isNaN(match.econ) ? match.econ.toFixed(1) + "%" : "Not reported for this year") + "<br>" +
                            "High Needs: " + (!isNaN(match.highNeeds) ? match.highNeeds.toFixed(1) + "%" : "N/A") + "<br>" +
                            "English Learners: " + (!isNaN(match.english) ? match.english.toFixed(1) + "%" : "N/A")
                        )
                        .style("left", (event.pageX + 12) + "px")
                        .style("top", (event.pageY + 12) + "px");
                } else {
                    tooltip
                        .style("opacity", 1)
                        .html(
                            "<strong>" + geoName + "</strong><br>" +
                            "District Code: " + code + "<br>" +
                            "No graduation data available"
                        )
                        .style("left", (event.pageX + 12) + "px")
                        .style("top", (event.pageY + 12) + "px");
                }
            })
            .on("mousemove", function(event) {
                tooltip
                    .style("left", (event.pageX + 12) + "px")
                    .style("top", (event.pageY + 12) + "px");
            })
            .on("mouseout", function() {
                d3.select(this)
                    .attr("stroke", "#444")
                    .attr("stroke-width", 0.7);

                tooltip.style("opacity", 0);
            });
    }
}