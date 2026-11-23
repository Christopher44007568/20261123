# Salt Lake Spectral Tower - rendered checks

Fixed camera at `(0.55, 2.95, 8.25)` looking at `(0.35, 1.34, -0.55)`, 39 degree vertical FOV, 1024x576.

| pass | samples/band | hero photons/band | seconds |
|---|---:|---:|---:|
| low | 8 | 40000 | 25.77 |
| high | 64 | 200000 | 140.57 |

## Spectral dispersion centroids

| lambda nm | x | y | z | receiver energy |
|---:|---:|---:|---:|---:|
| 410 | 1.3286 | 1.4323 | -1.3088 | 0.043480 |
| 430 | 1.6489 | 1.4098 | -1.3053 | 0.044362 |
| 450 | 1.9882 | 1.3853 | -1.3060 | 0.045038 |
| 470 | 2.3595 | 1.3586 | -1.3129 | 0.045705 |
| 490 | 2.8250 | 1.3294 | -1.3236 | 0.046252 |
| 510 | 3.4059 | 1.2937 | -1.3449 | 0.046829 |
| 530 | 3.9379 | 1.2572 | -1.3782 | 0.044912 |
| 550 | 4.2641 | 1.2318 | -1.4031 | 0.038354 |
| 570 | 4.2526 | 1.2300 | -1.3432 | 0.030763 |
| 590 | 3.7419 | 1.2640 | -1.1142 | 0.025265 |
| 610 | 2.9272 | 1.3210 | -0.7810 | 0.023164 |
| 630 | 2.3277 | 1.3640 | -0.5289 | 0.023846 |
| 650 | 2.1777 | 1.3768 | -0.4224 | 0.025889 |
| 670 | 2.2178 | 1.3759 | -0.3856 | 0.027929 |
| 690 | 2.2496 | 1.3748 | -0.3530 | 0.029223 |
| 710 | 2.2726 | 1.3742 | -0.3267 | 0.029602 |

Spectral centroid span: x `2.9355`, y `0.2024` m.

## RGB approximation vs spectral integration

| metric | spectral | RGB approximation |
|---|---:|---:|
| white-light receiver energy | 0.570610 | 0.585535 |
| image luminance energy | 24997.093744 | 25577.579325 |
| brass mirror R/B ratio | 2.2861 | 3.8888 |
| RGB-primary centroid span x | - | 0.4209 |
| RGB-primary centroid span y | - | 0.0268 |

## Band energy convergence

| lambda nm | low image energy | high image energy | relative delta |
|---:|---:|---:|---:|
| 410 | 25378.37163 | 25379.75319 | 0.005% |
| 430 | 25336.91350 | 25338.18078 | 0.005% |
| 450 | 25296.72014 | 25298.02263 | 0.005% |
| 470 | 25222.06682 | 25222.83562 | 0.003% |
| 490 | 25117.18135 | 25118.07093 | 0.004% |
| 510 | 25061.27151 | 25062.46036 | 0.005% |
| 530 | 25043.21381 | 25044.58148 | 0.005% |
| 550 | 25004.26340 | 25005.41399 | 0.005% |
| 570 | 24970.27674 | 24972.06253 | 0.007% |
| 590 | 24928.87737 | 24930.18833 | 0.005% |
| 610 | 24896.81664 | 24897.49061 | 0.003% |
| 630 | 24868.36204 | 24869.57916 | 0.005% |
| 650 | 24838.48905 | 24839.57678 | 0.004% |
| 670 | 24800.43293 | 24800.53827 | 0.000% |
| 690 | 24753.59522 | 24754.06083 | 0.002% |
| 710 | 24701.70097 | 24701.83248 | 0.001% |

Max image-energy delta: `0.007%` (`570 nm`). Max receiver-energy delta: `0.674%`.

## Geometry and methodology checks

- Geometry edge hashes identical: **yes**; edge pixels `5137`; wavelength misalignment pixels `0`.
- Hero wavelength sampling: 16 stratified hero bins per pixel; the 15 companion bands share the exact camera ray, subpixel jitter and random stream. This suppresses chromatic edge noise without aligning spectral caustics to a texture.
- The prism dispersion is produced by wavelength-dependent transport through code-defined Cauchy glass; no rainbow texture or image input exists.
- Brass uses tabulated complex IOR and complex Fresnel reflectance; dielectric interfaces use unpolarized s/p Fresnel reflection/transmission.
