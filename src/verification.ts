import { projectPixel, transformPoint, type HeadPose, type Vec3 } from "./math.ts";
import { PROBE, SHROUD, STEREO, WITNESS_POINT } from "./scene.ts";
import type { ReprojectionReport, StereoRenderer } from "./renderer.ts";

export interface DisparityProbe {
  side: "front" | "behind";
  probeDepth: number;
  leftXPx: number;
  rightXPx: number;
  signedDisparityPx: number;
  absoluteDisparityPx: number;
  direction: "left-image-right-of-right-image" | "left-image-left-of-right-image";
  expectedDirection: "left-image-right-of-right-image" | "left-image-left-of-right-image";
  directionCorrect: boolean;
}

export interface OcclusionProbe {
  side: "front" | "behind";
  expectedOccluded: boolean;
  leftOccluded: boolean;
  rightOccluded: boolean;
  leftSampledDepthM: number;
  rightSampledDepthM: number;
  leftGearDepthM: number;
  rightGearDepthM: number;
  consistent: boolean;
}

export interface TemporalStress {
  frames: number;
  tokenMismatches: number;
  sceneTimeMismatches: number;
  maxAbsYawStepRad: number;
  witnessMisses: number;
  witnessFailures: Array<{
    frame: number;
    eye: "left" | "right";
    rgba: readonly number[];
    x: number;
    y: number;
    nx: number;
    ny: number;
  }>;
  maxReprojectionErrorPx: number;
  passed: boolean;
}

export interface VerificationReport {
  passed: boolean;
  generatedAt: string;
  ipdM: number;
  convergencePlaneM: number;
  eyeBuffer: { width: number; height: number; color: string; depth: string };
  front: DisparityProbe;
  behind: DisparityProbe;
  disparityDirectionOk: boolean;
  disparityMagnitudeMonotonic: boolean;
  occlusion: { front: OcclusionProbe; behind: OcclusionProbe; consistent: boolean };
  temporal: TemporalStress;
  reprojection: ReprojectionReport & { passed: boolean };
}

const NEUTRAL_HEAD: HeadPose = {
  position: [0, 0, 0],
  yaw: 0,
  pitch: 0,
  roll: 0,
};

function measureDisparity(
  renderer: StereoRenderer,
  side: "front" | "behind",
): DisparityProbe {
  const blend = side === "front" ? 0 : 1;
  renderer.renderFrame(8.5, NEUTRAL_HEAD, blend);
  const snapshot = renderer.getLastSnapshot();
  if (!snapshot) throw new Error("Scene snapshot unavailable.");
  const width = renderer.eyeBufferInfo.width;
  const height = renderer.eyeBufferInfo.height;
  const point = snapshot.probeCenter;
  const left = projectPixel(snapshot.eyes[0].viewProjection, point, width, height);
  const right = projectPixel(snapshot.eyes[1].viewProjection, point, width, height);
  const signed = left.x - right.x;
  const expectedPositive = Math.abs(point[2]) < STEREO.screenDistance;
  return {
    side,
    probeDepth: Math.abs(point[2]),
    leftXPx: left.x,
    rightXPx: right.x,
    signedDisparityPx: signed,
    absoluteDisparityPx: Math.abs(signed),
    direction:
      signed > 0
        ? "left-image-right-of-right-image"
        : "left-image-left-of-right-image",
    expectedDirection: expectedPositive
      ? "left-image-right-of-right-image"
      : "left-image-left-of-right-image",
    directionCorrect:
      Math.abs(signed) > 0.5 &&
      (expectedPositive ? signed > 0 : signed < 0),
  };
}

function measureOcclusion(
  renderer: StereoRenderer,
  side: "front" | "behind",
): OcclusionProbe {
  const blend = side === "front" ? 0 : 1;
  renderer.renderFrame(8.5, NEUTRAL_HEAD, blend);
  const snapshot = renderer.getLastSnapshot();
  if (!snapshot) throw new Error("Scene snapshot unavailable.");
  const point = snapshot.probeToothPoint;
  const expectedOccluded =
    point[2] < snapshot.shroudSurfaceZ &&
    Math.abs(point[1]) < SHROUD.height * 0.5 &&
    Math.abs(point[0]) < SHROUD.radius * Math.sin(SHROUD.halfAngle);

  const gearDepth = (eyeIndex: 0 | 1): number => {
    const viewPoint = transformPoint(snapshot.eyes[eyeIndex].view, point);
    return -viewPoint[2];
  };
  const sampled = (eyeIndex: 0 | 1): number => {
    const depth = renderer.sampleEyeDepth(eyeIndex, point);
    return depth ?? Number.POSITIVE_INFINITY;
  };
  const leftGearDepth = gearDepth(0);
  const rightGearDepth = gearDepth(1);
  const leftSampled = sampled(0);
  const rightSampled = sampled(1);
  const occlusionThresholdM = 0.014;
  const leftOccluded = Number.isFinite(leftSampled) && leftSampled < leftGearDepth - occlusionThresholdM;
  const rightOccluded = Number.isFinite(rightSampled) && rightSampled < rightGearDepth - occlusionThresholdM;
  return {
    side,
    expectedOccluded,
    leftOccluded,
    rightOccluded,
    leftSampledDepthM: leftSampled,
    rightSampledDepthM: rightSampled,
    leftGearDepthM: leftGearDepth,
    rightGearDepthM: rightGearDepth,
    consistent:
      Number.isFinite(leftSampled) &&
      Number.isFinite(rightSampled) &&
      leftOccluded === rightOccluded &&
      leftOccluded === expectedOccluded,
  };
}

function stressTemporalSync(renderer: StereoRenderer): {
  result: TemporalStress;
  reprojection: ReprojectionReport;
} {
  const frames = 24;
  let tokenMismatches = 0;
  let sceneTimeMismatches = 0;
  let maxAbsYawStepRad = 0;
  let witnessMisses = 0;
  const witnessFailures: TemporalStress["witnessFailures"] = [];
  let previousYaw = 0;
  let maxReprojectionErrorPx = 0;
  let maxLeftReprojectionPx = 0;
  let maxRightReprojectionPx = 0;
  let reprojectionSamples = 0;
  let latestReprojection: ReprojectionReport | null = null;

  for (let index = 0; index < frames; index += 1) {
    const time = 20 + index / 90;
    const yaw = 0.105 * Math.sin(index * 1.83) + 0.008 * Math.cos(index * 0.47);
    const pitch = 0.072 * Math.sin(index * 2.41 + 0.4);
    const roll = 0.058 * Math.cos(index * 1.37);
    const head: HeadPose = {
      position: [
        0.008 * Math.sin(index * 1.21),
        0.006 * Math.cos(index * 1.77),
        0.009 * Math.sin(index * 0.91 + 0.2),
      ],
      yaw,
      pitch,
      roll,
    };
    if (index > 0) maxAbsYawStepRad = Math.max(maxAbsYawStepRad, Math.abs(yaw - previousYaw));
    previousYaw = yaw;
    renderer.renderFrame(time, head, index % 2);
    const audit = renderer.getLastAudit();
    if (!audit) throw new Error("Frame audit unavailable.");
    if (audit.leftToken !== audit.rightToken) tokenMismatches += 1;
    if (audit.leftSceneTime !== audit.rightSceneTime || !audit.sameSceneTime) sceneTimeMismatches += 1;
    const checkWitness = (eyeIndex: 0 | 1): boolean => {
      const sample = renderer.sampleEyeColor(eyeIndex, WITNESS_POINT, 10);
      if (!sample) {
        witnessFailures.push({
          frame: index,
          eye: eyeIndex === 0 ? "left" : "right",
          rgba: [],
          x: 0,
          y: 0,
          nx: 0,
          ny: 0,
        });
        return false;
      }
      const [red, green, blue] = sample.rgba;
      const visible = green > 170 && blue > 170 && blue > red * 1.25;
      if (!visible) {
        witnessFailures.push({
          frame: index,
          eye: eyeIndex === 0 ? "left" : "right",
          rgba: sample.rgba,
          x: sample.x,
          y: sample.y,
          nx: sample.nx,
          ny: sample.ny,
        });
      }
      return visible;
    };
    if (!checkWitness(0) || !checkWitness(1)) witnessMisses += 1;
    if (index % 4 === 0 || index === frames - 1) {
      latestReprojection = renderer.measureReprojection();
      maxReprojectionErrorPx = Math.max(maxReprojectionErrorPx, latestReprojection.maxErrorPx);
      maxLeftReprojectionPx = Math.max(maxLeftReprojectionPx, latestReprojection.leftMaxErrorPx);
      maxRightReprojectionPx = Math.max(maxRightReprojectionPx, latestReprojection.rightMaxErrorPx);
      reprojectionSamples += latestReprojection.samples;
    }
  }

  const result: TemporalStress = {
    frames,
    tokenMismatches,
    sceneTimeMismatches,
    maxAbsYawStepRad,
    witnessMisses,
    witnessFailures,
    maxReprojectionErrorPx,
    passed:
      tokenMismatches === 0 &&
      sceneTimeMismatches === 0 &&
      witnessMisses === 0 &&
      maxAbsYawStepRad > 0.08 &&
      maxReprojectionErrorPx < 0.75,
  };
  return {
    result,
    reprojection: {
      maxErrorPx: maxReprojectionErrorPx,
      samples: reprojectionSamples,
      leftMaxErrorPx: maxLeftReprojectionPx,
      rightMaxErrorPx: maxRightReprojectionPx,
    },
  };
}

function combineReprojection(reports: readonly ReprojectionReport[]): ReprojectionReport {
  return reports.reduce<ReprojectionReport>(
    (combined, report) => ({
      maxErrorPx: Math.max(combined.maxErrorPx, report.maxErrorPx),
      samples: combined.samples + report.samples,
      leftMaxErrorPx: Math.max(combined.leftMaxErrorPx, report.leftMaxErrorPx),
      rightMaxErrorPx: Math.max(combined.rightMaxErrorPx, report.rightMaxErrorPx),
    }),
    { maxErrorPx: 0, samples: 0, leftMaxErrorPx: 0, rightMaxErrorPx: 0 },
  );
}

export function runVerification(renderer: StereoRenderer): VerificationReport {
  const originalMode = renderer.getViewMode();
  const front = measureDisparity(renderer, "front");
  const frontReprojection = renderer.measureReprojection();
  const behind = measureDisparity(renderer, "behind");
  const behindReprojection = renderer.measureReprojection();
  const frontOcclusion = measureOcclusion(renderer, "front");
  const behindOcclusion = measureOcclusion(renderer, "behind");
  const temporal = stressTemporalSync(renderer);
  const reprojection = combineReprojection([
    frontReprojection,
    behindReprojection,
    temporal.reprojection,
  ]);
  const disparityDirectionOk = front.directionCorrect && behind.directionCorrect;
  const disparityMagnitudeMonotonic =
    front.absoluteDisparityPx > behind.absoluteDisparityPx + 1 &&
    front.absoluteDisparityPx > 1 &&
    behind.absoluteDisparityPx > 1;
  const occlusionConsistent = frontOcclusion.consistent && behindOcclusion.consistent;
  const reprojectionPassed =
    reprojection.samples > 0 &&
    Number.isFinite(reprojection.maxErrorPx) &&
    reprojection.maxErrorPx < 0.75;
  const passed =
    disparityDirectionOk &&
    disparityMagnitudeMonotonic &&
    occlusionConsistent &&
    temporal.result.passed &&
    reprojectionPassed;

  renderer.setViewMode(originalMode);
  return {
    passed,
    generatedAt: new Date().toISOString(),
    ipdM: STEREO.ipd,
    convergencePlaneM: STEREO.screenDistance,
    eyeBuffer: {
      width: renderer.eyeBufferInfo.width,
      height: renderer.eyeBufferInfo.height,
      color: renderer.eyeBufferInfo.colorFormat,
      depth: renderer.eyeBufferInfo.depthFormat,
    },
    front,
    behind,
    disparityDirectionOk,
    disparityMagnitudeMonotonic,
    occlusion: {
      front: frontOcclusion,
      behind: behindOcclusion,
      consistent: occlusionConsistent,
    },
    temporal: temporal.result,
    reprojection: { ...reprojection, passed: reprojectionPassed },
  };
}

export function probeSignedDisparity(renderer: StereoRenderer): number {
  const snapshot = renderer.getLastSnapshot();
  if (!snapshot) return 0;
  const width = renderer.eyeBufferInfo.width;
  const height = renderer.eyeBufferInfo.height;
  const left = projectPixel(snapshot.eyes[0].viewProjection, snapshot.probeCenter, width, height);
  const right = projectPixel(snapshot.eyes[1].viewProjection, snapshot.probeCenter, width, height);
  return left.x - right.x;
}

export function reportProbeTargets(): { x: number; front: Vec3; behind: Vec3 } {
  return {
    x: PROBE.x,
    front: [PROBE.x, PROBE.y, PROBE.frontZ],
    behind: [PROBE.x, PROBE.y, PROBE.backZ],
  };
}
