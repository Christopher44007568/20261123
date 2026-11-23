import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildGhostDefs, lightAngularRadiusNdc, beaconPulse } from '../src/flare/optics.ts';

test('鬼影沿光轴排布的 k 值随焦距缩放', () => {
  const wide = buildGhostDefs(24, 2.8);
  const tele = buildGhostDefs(70, 2.8);
  assert.ok(tele[3].k > wide[3].k);
  assert.ok(wide.every((g) => g.k > 0));
});

test('光圈收小使孔径鬼影变小、通光量按平方下降', () => {
  const open = buildGhostDefs(35, 1.4);
  const stopped = buildGhostDefs(35, 5.6);
  assert.ok(stopped[0].radiusNdc < open[0].radiusNdc);
  const ratio = stopped[0].intensity / open[0].intensity;
  assert.ok(Math.abs(ratio - (1.4 / 5.6) ** 2) < 1e-9);
});

test('光源角半径随距离衰减并被夹紧', () => {
  assert.equal(lightAngularRadiusNdc(1, 0, 1), 1);
  const near = lightAngularRadiusNdc(0.5, 5, Math.tan(0.5));
  const far = lightAngularRadiusNdc(0.5, 50, Math.tan(0.5));
  assert.ok(far < near);
  assert.ok(far > 0);
});

test('旋转信标脉冲在扫描窗口内出现峰值', () => {
  const idle = beaconPulse(0);
  const sweep = beaconPulse(0.6);
  assert.ok(sweep > idle * 2);
  assert.ok(idle >= 0 && sweep <= 1);
});
