#!/usr/bin/env bash
set -euo pipefail

root="${1:-artifacts}"
preview="$root/previews"
mkdir -p "$preview"

for cut in corridor top; do
    if [[ ! -d "$root/$cut" ]]; then
        continue
    fi
    convert "$root/$cut/color.ppm" "$preview/${cut}_color.png"
    convert "$root/$cut/normal.ppm" "$preview/${cut}_normal.png"
    convert "$root/$cut/material.ppm" "$preview/${cut}_material.png"
    convert "$root/$cut/depth.pgm" "$preview/${cut}_depth.png"
    convert "$root/$cut/cut_preview.ppm" "$preview/${cut}_cut_preview.png"
    montage \
        -label "Color" "$preview/${cut}_color.png" \
        -label "Depth (near bright)" "$preview/${cut}_depth.png" \
        -label "World normal" "$preview/${cut}_normal.png" \
        -label "Material ID palette" "$preview/${cut}_material.png" \
        -label "Tri/SDF cut intersection" \
        "$preview/${cut}_cut_preview.png" \
        -tile 3x2 -geometry 420x236+8+8 -background "#0b1118" \
        -fill "#e8edf2" -pointsize 18 \
        "$preview/${cut}_channels.png"
done

if [[ -f "$root/reference_sheet.ppm" ]]; then
    convert "$root/reference_sheet.ppm" "$preview/reference_sheet.png"
fi

echo "PNG previews written to $preview"
