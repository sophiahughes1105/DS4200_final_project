Promise.all([
    d3.csv("AllSchool_17_22.csv"),
    d3.json("SCHOOLDISTRICTS_POLY.json")
]).then(function(files) {
    let csv_data = files[0];
    let geo_data = files[1];

    console.log("CSV rows:", csv_data.length);
    console.log("Geo features:", geo_data.features.length);
    console.log("First geo properties:", geo_data.features[0].properties);

    make_map(csv_data, geo_data);
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

// title
svg.append("text")
    .attr("x", width / 2)
    .attr("y", 24)
    .attr("text-anchor", "middle")
    .style("font-size", "18px")
    .style("font-weight", "bold")
    .text("Massachusetts School Districts: Graduation Rate by Year");


// turn school code into district code
function get_district_code_from_school_code(school_code) {
    let code = Number(school_code);

    if (isNaN(code)) {
        return null;
    }

    let district_code = Math.floor(code / 10000);
    return String(district_code).padStart(4, "0");
}


// clean district names for fallback matching
function clean_name(name) {
    if (!name) {
        return "";
    }

    return name
        .toLowerCase()
        .replace(/[-–]/g, " ")
        .replace(/\(district\)/g, "")
        .replace(/\(charter\)/g, "")
        .replace(/public schools?/g, "")
        .replace(/school district/g, "")
        .replace(/district/g, "")
        .replace(/community school/g, "")
        .replace(/regional/g, "")
        .replace(/\s+/g, " ")
        .trim();
}


// build lookup from member town -> regional district code
function build_member_town_lookup(geo_data) {
    let member_town_to_regional_code = {};

    geo_data.features.forEach(function(feature) {
        let district_code = String(feature.properties.ORG4CODE || "").padStart(4, "0");
        let member_list = feature.properties.MEMBERLIST;
        let district_name = feature.properties.DISTRICT_N || "";
        let clean_district_name = clean_name(district_name);

        if (!member_list) {
            return;
        }

        let members = member_list.split(",").map(function(name) {
            return clean_name(name);
        });

        // use only true multi-town regional relationships
        if (members.length > 1) {
            members.forEach(function(member_name) {
                if (member_name && member_name !== clean_district_name) {
                    member_town_to_regional_code[member_name] = district_code;
                }
            });
        }
    });

    return member_town_to_regional_code;
}


// helper for matching a map feature to district data
//
// FIX: Steps 1 and 2 now require a valid (non-NaN) grad_rate before returning.
// Elementary-only districts (K-8 towns like Boxford, Lincoln, Sudbury) exist in
// district_data with NaN grad_rates, which previously short-circuited the lookup
// before step 3 could route them to their regional HS district (Masconomet,
// Lincoln-Sudbury, etc.). Now those towns fall through to the member-town lookup
// and correctly inherit the regional district's graduation data.
// Step 4 is a safety net that returns any match without grad data as a last resort,
// preserving tooltip info for districts that genuinely have no graduation data.
function get_match_for_feature(feature, district_data, district_data_by_name, member_town_to_regional_code) {
    let code = String(feature.properties.ORG4CODE || "").padStart(4, "0");
    let geo_name = feature.properties.DISTRICT_N || "";
    let clean_geo_name = clean_name(geo_name);

    // 1. direct code match — only accept if it has real grad data
    if (district_data[code] && !isNaN(district_data[code].grad_rate)) {
        return district_data[code];
    }

    // 2. direct cleaned-name match — only accept if it has real grad data
    if (district_data_by_name[clean_geo_name] && !isNaN(district_data_by_name[clean_geo_name].grad_rate)) {
        return district_data_by_name[clean_geo_name];
    }

    // 3. member-town -> regional district fallback
    // handles towns like Boxford -> Masconomet, Lincoln/Sudbury -> Lincoln-Sudbury
    let regional_code = member_town_to_regional_code[clean_geo_name];
    if (regional_code && district_data[regional_code]) {
        return district_data[regional_code];
    }

    // 4. last resort: return any match even without grad data
    // (preserves tooltip info for districts that genuinely have no graduation data)
    if (district_data[code]) return district_data[code];
    if (district_data_by_name[clean_geo_name]) return district_data_by_name[clean_geo_name];

    return null;
}


// draw legend
function draw_legend(color_scale, min_rate, max_rate) {
    svg.selectAll(".legend_group").remove();

    let legend_width = 240;
    let legend_height = 16;
    let legend_x = 40;
    let legend_y = 70; // shifted down from 40 to give title breathing room

    let legend_group = svg.append("g")
        .attr("class", "legend_group");

    let defs = svg.select("defs");
    if (defs.empty()) {
        defs = svg.append("defs");
    }

    defs.select("#legend_gradient").remove();

    let gradient = defs.append("linearGradient")
        .attr("id", "legend_gradient")
        .attr("x1", "0%")
        .attr("x2", "100%")
        .attr("y1", "0%")
        .attr("y2", "0%");

    let num_stops = 20;

    for (let i = 0; i <= num_stops; i++) {
        let t = i / num_stops;
        let value = min_rate + t * (max_rate - min_rate);

        gradient.append("stop")
            .attr("offset", (t * 100) + "%")
            .attr("stop-color", color_scale(value));
    }

    legend_group.append("text")
        .attr("x", legend_x)
        .attr("y", legend_y - 10)
        .style("font-size", "14px")
        .style("font-weight", "bold")
        .text("Graduation Rate");

    legend_group.append("rect")
        .attr("x", legend_x)
        .attr("y", legend_y)
        .attr("width", legend_width)
        .attr("height", legend_height)
        .attr("fill", "url(#legend_gradient)")
        .attr("stroke", "#333")
        .attr("stroke-width", 0.5);

    let legend_scale = d3.scaleLinear()
        .domain([min_rate, max_rate])
        .range([legend_x, legend_x + legend_width]);

    let legend_axis = d3.axisBottom(legend_scale)
        .ticks(5)
        .tickFormat(function(d) {
            return d.toFixed(0) + "%";
        });

    legend_group.append("g")
        .attr("transform", "translate(0," + (legend_y + legend_height) + ")")
        .call(legend_axis);
}


function make_map(csv_data, geo_data) {

    // clean csv
    csv_data.forEach(function(d) {
        d.year = parseFloat(d.year);
        d.grad_rate = parseFloat(d["% Graduated"]);
        d.cohort = parseFloat(d["# in Cohort"]);

        d.econ = parseFloat(d["Economically Disadvantaged%"]);
        d.high_needs = parseFloat(d["High Needs%"]);
        d.english = parseFloat(d["English Learners%"]);

        d.school_code = d["School Code"];
        d.org4 = get_district_code_from_school_code(d.school_code);

        if (d["School Name"]) {
            d.district = d["School Name"].split(" - ")[0].trim();
            d.clean_district = clean_name(d.district);
        } else {
            d.district = "";
            d.clean_district = "";
        }
    });

    console.log(
        "Metric parse check:",
        csv_data.slice(0, 15).map(function(d) {
            return {
                school: d["School Name"],
                year: d.year,
                grad_rate: d.grad_rate,
                econ: d.econ,
                high_needs: d.high_needs,
                english: d.english
            };
        })
    );

    // keep rows with valid district code and year
    let grad_data = csv_data.filter(function(d) {
        return !isNaN(d.year) && d.org4 !== null;
    });

    console.log("Filtered rows:", grad_data.length);
    console.log("Sample csv row:", grad_data[0]);

    // unique years
    let years = [];
    grad_data.forEach(function(d) {
        if (!years.includes(d.year)) {
            years.push(d.year);
        }
    });

    years.sort(function(a, b) {
        return a - b;
    });

    let year_select = d3.select("#yearSelect");

    year_select.selectAll("option").remove();

    year_select.selectAll("option")
        .data(years)
        .enter()
        .append("option")
        .attr("value", function(d) {
            return d;
        })
        .text(function(d) {
            return d;
        });

    let selected_year = years[years.length - 1];
    year_select.property("value", selected_year);

    // projected coordinates from MassGIS
    let projection = d3.geoIdentity()
        .reflectY(true)
        .fitSize([width, height], geo_data);

    let path = d3.geoPath().projection(projection);

    let member_town_to_regional_code = build_member_town_lookup(geo_data);
    console.log("Member town lookup:", member_town_to_regional_code);

    update_map(selected_year);

    year_select.on("change", function() {
        selected_year = +this.value;
        update_map(selected_year);
    });

    function update_map(year) {

        let one_year_data = grad_data.filter(function(d) {
            return d.year === year;
        });

        console.log("Rows for year", year, one_year_data.length);

        let district_sums = {};
        let district_info = {};

        one_year_data.forEach(function(d) {
            let code = d.org4;

            if (!district_sums[code]) {
                district_sums[code] = {
                    grad_weighted_sum: 0,
                    grad_cohort_sum: 0,

                    econ_weighted_sum: 0,
                    econ_count: 0,

                    high_needs_weighted_sum: 0,
                    high_needs_count: 0,

                    english_weighted_sum: 0,
                    english_count: 0
                };

                district_info[code] = {
                    district_name: d.district,
                    clean_district: d.clean_district
                };
            }

            // graduation rate: cohort-weighted
            if (!isNaN(d.grad_rate) && !isNaN(d.cohort) && d.cohort > 0) {
                district_sums[code].grad_weighted_sum += d.grad_rate * d.cohort;
                district_sums[code].grad_cohort_sum += d.cohort;
            }

            // economically disadvantaged: cohort-weighted
            if (!isNaN(d.econ) && !isNaN(d.cohort) && d.cohort > 0) {
                district_sums[code].econ_weighted_sum += d.econ * d.cohort;
                district_sums[code].econ_count += d.cohort;
            }

            // high needs: cohort-weighted
            if (!isNaN(d.high_needs) && !isNaN(d.cohort) && d.cohort > 0) {
                district_sums[code].high_needs_weighted_sum += d.high_needs * d.cohort;
                district_sums[code].high_needs_count += d.cohort;
            }

            // english learners: cohort-weighted
            if (!isNaN(d.english) && !isNaN(d.cohort) && d.cohort > 0) {
                district_sums[code].english_weighted_sum += d.english * d.cohort;
                district_sums[code].english_count += d.cohort;
            }
        });

        let district_data = {};

        for (let code in district_sums) {
            district_data[code] = {
                grad_rate: district_sums[code].grad_cohort_sum > 0
                    ? district_sums[code].grad_weighted_sum / district_sums[code].grad_cohort_sum
                    : NaN,

                econ: district_sums[code].econ_count > 0
                    ? district_sums[code].econ_weighted_sum / district_sums[code].econ_count
                    : NaN,

                high_needs: district_sums[code].high_needs_count > 0
                    ? district_sums[code].high_needs_weighted_sum / district_sums[code].high_needs_count
                    : NaN,

                english: district_sums[code].english_count > 0
                    ? district_sums[code].english_weighted_sum / district_sums[code].english_count
                    : NaN,

                cohort: district_sums[code].grad_cohort_sum,
                district_name: district_info[code].district_name,
                clean_district: district_info[code].clean_district
            };
        }

        // fallback lookup by cleaned district name
        let district_data_by_name = {};
        for (let code in district_data) {
            let clean_district = district_data[code].clean_district;
            if (clean_district) {
                district_data_by_name[clean_district] = district_data[code];
            }
        }

        // debug null districts
        let no_match = [];
        let no_grad_rate = [];

        geo_data.features.forEach(function(d) {
            let code = String(d.properties.ORG4CODE || "").padStart(4, "0");
            let geo_name = d.properties.DISTRICT_N;

            let match = get_match_for_feature(
                d,
                district_data,
                district_data_by_name,
                member_town_to_regional_code
            );

            if (!match) {
                no_match.push({
                    name: geo_name,
                    code: code
                });
            } else if (isNaN(match.grad_rate)) {
                no_grad_rate.push({
                    name: geo_name,
                    code: code
                });
            }
        });

        console.log("NO MATCH (join issue):", no_match);
        console.log("MATCH BUT NO DATA:", no_grad_rate);
        console.log("NULL DISTRICT NAMES:", no_match.map(function(d) {
            return d.name;
        }));
        console.log("NO DATA DISTRICT NAMES:", no_grad_rate.map(function(d) {
            return d.name;
        }));

        let grad_rates = [];
        for (let code in district_data) {
            if (!isNaN(district_data[code].grad_rate)) {
                grad_rates.push(district_data[code].grad_rate);
            }
        }

        let min_rate = d3.min(grad_rates);
        let max_rate = d3.max(grad_rates);

        console.log("Min grad rate:", min_rate);
        console.log("Max grad rate:", max_rate);

        let color_scale = d3.scaleSequential()
            .domain([min_rate, max_rate])
            .interpolator(function(t) {
                return d3.interpolateViridis(1 - t);
            });

        draw_legend(color_scale, min_rate, max_rate);

        svg.selectAll("path")
            .data(geo_data.features)
            .join("path")
            .attr("d", path)
            .attr("fill", function(d) {
                let match = get_match_for_feature(
                    d,
                    district_data,
                    district_data_by_name,
                    member_town_to_regional_code
                );

                if (match && !isNaN(match.grad_rate)) {
                    return color_scale(match.grad_rate);
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

                let code = String(d.properties.ORG4CODE || "").padStart(4, "0");
                let geo_name = d.properties.DISTRICT_N;

                let match = get_match_for_feature(
                    d,
                    district_data,
                    district_data_by_name,
                    member_town_to_regional_code
                );

                if (match) {
                    tooltip
                        .style("opacity", 1)
                        .html(
                            "<strong>" + geo_name + "</strong><br>" +
                            "District Code: " + code + "<br>" +
                            "Year: " + year + "<br>" +
                            "Graduation Rate: " + (!isNaN(match.grad_rate) ? match.grad_rate.toFixed(1) + "%" : "N/A") + "<br>" +
                            "Total Cohort: " + (!isNaN(match.cohort) ? match.cohort : "N/A") + "<br>" +
                            "Economically Disadvantaged: " + (!isNaN(match.econ) ? match.econ.toFixed(1) + "%" : "Not reported for this year") + "<br>" +
                            "High Needs: " + (!isNaN(match.high_needs) ? match.high_needs.toFixed(1) + "%" : "N/A") + "<br>" +
                            "English Learners: " + (!isNaN(match.english) ? match.english.toFixed(1) + "%" : "N/A")
                        )
                        .style("left", (event.pageX + 12) + "px")
                        .style("top", (event.pageY + 12) + "px");
                } else {
                    tooltip
                        .style("opacity", 1)
                        .html(
                            "<strong>" + geo_name + "</strong><br>" +
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
