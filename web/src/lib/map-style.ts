import type { StyleSpecification } from "maplibre-gl";

const PAINT: Record<string, Record<string, string>> = {
  background: { "background-color": "#eef1f5" },
  park: { "fill-color": "#cfe9c6" },
  landcover_wood: { "fill-color": "#d5ecca" },
  water: { "fill-color": "#b9d6f5" },
  waterway: { "line-color": "#b9d6f5" },
  landuse_residential: { "fill-color": "#eceff3" },
  building: { "fill-color": "#e4e8ee", "fill-outline-color": "#dbe0e7" },
  highway_path: { "line-color": "#ffffff" },
  highway_minor: { "line-color": "#ffffff" },
  highway_major_casing: { "line-color": "#dde2ea" },
  highway_major_inner: { "line-color": "#ffffff" },
  highway_motorway_casing: { "line-color": "#d6dce6" },
  highway_motorway_inner: { "line-color": "#ffffff" },
  railway: { "line-color": "#c9ced8" },
  railway_transit: { "line-color": "#c9ced8" },
  "highway-name-minor": { "text-color": "#8a93a5" },
  "highway-name-major": { "text-color": "#6f7a8e" },
  label_other: { "text-color": "#7a8497" },
  label_village: { "text-color": "#4c5870" },
  label_town: { "text-color": "#3d4860" },
  label_city: { "text-color": "#2a3448" },
  water_name_point_label: { "text-color": "#5b84bf" },
  water_name_line_label: { "text-color": "#5b84bf" },
};

export function restyleMap(style: StyleSpecification) {
  for (const layer of style.layers) {
    const paint = PAINT[layer.id];
    if (paint && "paint" in layer)
      layer.paint = { ...(layer.paint as object), ...paint } as never;
  }
  return style;
}
