"use client";
import React, { useState, useEffect, useRef, useCallback } from 'react';
import Crosshair from '@/app/components/crosshair';
import TargetCursor from '@/components/TargetCursor';
import PixelSnow from '@/app/components/snow';

interface Asteroid {
  id: number; x: number; y: number; size: number;
  speedX: number; speedY: number; rotation: number; rotationSpeed: number;
  hp: number; maxHp: number; type: 'normal' | 'fast' | 'armored' | 'splitting';
}
interface Bullet { id: number; x: number; y: number; vx: number; vy: number; }
interface EnemyBullet { id: number; x: number; y: number; vx: number; vy: number; damage: number; color?: string; }
interface EnemyShip { id: number; x: number; y: number; hp: number; maxHp: number; shield: number; maxShield: number; vx: number; vy: number; rotation: number; lastShot: number; type: 'fighter' | 'sniper' | 'captain' | 'aggressive' | 'grenadier'; charging: boolean; chargeUntil: number; freezeLeadMs: number; aimX: number; aimY: number; shotX: number; shotY: number; }
interface EnemyBeam { id: number; x1: number; y1: number; x2: number; y2: number; expiresAt: number; type: 'telegraph' | 'sniper'; }
interface EnemyMissile { id: number; x: number; y: number; vx: number; vy: number; born: number; trackUntil: number; }
interface Particle { id: number; x: number; y: number; vx: number; vy: number; life: number; size: number; color?: string; }
interface PowerUp { id: number; x: number; y: number; type: 'shield' | 'rapidfire' | 'spread' | 'health' | 'overshield'; }
interface ActivePowerUp { type: PowerUp['type']; endTime: number; startTime: number; }
interface Beam { id: number; targetX: number; targetY: number; damage: number; }
interface Missile { id: number; x: number; y: number; vx: number; vy: number; targetId: number; targetType: 'asteroid' | 'ship'; born: number; }
interface AsteroidSpec { type: Asteroid['type']; size: number; hp: number; speedMul: number; }

// ── All mutable game state lives here, outside React ──
const G = {
  asteroids: [] as Asteroid[],
  bullets: [] as Bullet[],
  enemyBullets: [] as EnemyBullet[],
  enemyBeams: [] as EnemyBeam[],
  enemyMissiles: [] as EnemyMissile[],
  enemyShips: [] as EnemyShip[],
  particles: [] as Particle[],
  powerUps: [] as PowerUp[],
  activePowerUps: [] as ActivePowerUp[],
  beams: [] as Beam[],
  missiles: [] as Missile[],
  ship: { x: 0, y: 0 },
  vel: { x: 0, y: 0 },
  mouse: { x: 0, y: 0 },
  hp: 100,
  playerShield: 0,
  playerBaseShieldMax: 100,
  playerOverShieldMax: 100,
  deathsDefied: 1,
  score: 0,
  invincible: false,
  deathDefied: false,
  timeSlow: false,
  timeSlowCooldown: 0,
  missileCooldown: 0,
  nextId: 0,
  lastShot: 0,
  lastHit: 0,
  lastPlayerDamageAt: 0,
  lastShieldRegenAt: 0,
  wave: 0,
  waveSpawnEndsAt: 0,
  waveEndCuePlayed: true,
  firstCaptainOverShieldDropped: false,
  running: false,
};

function id() { return G.nextId++; }

function dist(ax: number, ay: number, bx: number, by: number) {
  const dx = ax - bx, dy = ay - by;
  return Math.hypot(dx, dy);
}

function pointToSegmentDistance(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return dist(px, py, x1, y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return dist(px, py, cx, cy);
}

function enemyShipReward(type: EnemyShip['type']) {
  if (type === 'captain') return 240;
  if (type === 'sniper') return 180;
  if (type === 'grenadier') return 170;
  if (type === 'aggressive') return 120;
  return 150;
}

function enemyShipDropChance(type: EnemyShip['type']) {
  if (type === 'captain') return 0.4;
  if (type === 'grenadier') return 0.26;
  if (type === 'aggressive') return 0.22;
  return 0.3;
}

function shouldDropOverShield(type: EnemyShip['type']) {
  if (type !== 'captain') return false;
  if (!G.firstCaptainOverShieldDropped) {
    G.firstCaptainOverShieldDropped = true;
    return true;
  }
  return Math.random() < 0.2;
}

function damageEnemyShip(ship: EnemyShip, damage: number) {
  if (ship.shield > 0) {
    const absorbed = Math.min(ship.shield, damage);
    const remaining = damage - absorbed;
    return { ...ship, shield: ship.shield - absorbed, hp: ship.hp - remaining };
  }
  return { ...ship, hp: ship.hp - damage };
}

function hasPU(type: string) {
  return G.activePowerUps.some(p => p.type === type && Date.now() < p.endTime);
}

function spawnParticles(x: number, y: number, count = 8, color?: string) {
  for (let i = 0; i < count; i++) {
    const a = (Math.PI * 2 * i) / count;
    const s = 2 + Math.random() * 3;
    G.particles.push({ id: id(), x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, size: 3 + Math.random() * 3, color });
  }
}

function spawnPowerUp(x: number, y: number) {
  const types: PowerUp['type'][] = ['rapidfire', 'spread', 'health'];
  G.powerUps.push({ id: id(), x, y, type: types[Math.floor(Math.random() * 3)] });
}

function spawnAsteroidPowerUp(x: number, y: number) {
  const types: PowerUp['type'][] = ['rapidfire', 'spread', 'health'];
  G.powerUps.push({ id: id(), x, y, type: types[Math.floor(Math.random() * 3)] });
}

function spawnOverShieldPowerUp(x: number, y: number) {
  G.powerUps.push({ id: id(), x, y, type: 'overshield' });
}

function asteroidColor(type: Asteroid['type']) {
  if (type === 'fast') return '#00ffff';
  if (type === 'armored') return '#ff8800';
  if (type === 'splitting') return '#ff00ff';
  return undefined;
}

function puColor(type: PowerUp['type']) {
  if (type === 'shield') return '#00ccff';
  if (type === 'overshield') return '#00ff66';
  if (type === 'rapidfire') return '#ffff00';
  if (type === 'spread') return '#ff00ff';
  return '#00ff00';
}

function hpColor(current: number, max: number) {
  if (current > max * 0.5) return '#0f0';
  if (current > max * 0.25) return '#ff0';
  return '#f44';
}

function scoreMessage(score: number) {
  if (score > 500) return 'Excellent!';
  if (score > 300) return 'Great job!';
  if (score > 100) return 'Good try!';
  return 'Keep practicing!';
}

function powerUpIcon(type: PowerUp['type']) {
  if (type === 'shield') return '🛡';
  if (type === 'overshield') return '⬢';
  if (type === 'rapidfire') return '⚡';
  if (type === 'spread') return '◈';
  return '+';
}

function asteroidStrokeColor(type: Asteroid['type']) {
  if (type === 'fast') return '#0ff';
  if (type === 'armored') return '#f80';
  if (type === 'splitting') return '#f0f';
  return 'white';
}

function normalAsteroidHp(size: number) {
  if (size > 60) return 8;
  if (size > 50) return 5;
  if (size > 40) return 3;
  return 2;
}

function asteroidSpecFromRoll(r: number): AsteroidSpec {
  if (r < 0.6) {
    const size = 30 + Math.random() * 40;
    return { type: 'normal', size, hp: normalAsteroidHp(size), speedMul: 1 };
  }
  if (r < 0.8) {
    return { type: 'fast', size: 20 + Math.random() * 20, hp: 2, speedMul: 2 };
  }
  if (r < 0.95) {
    return { type: 'armored', size: 60 + Math.random() * 20, hp: 15, speedMul: 0.5 };
  }
  return { type: 'splitting', size: 40 + Math.random() * 20, hp: 4, speedMul: 1 };
}

const TIME_SLOW_ANGLES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

export default function AsteroidShooter() {
  const [tick, setTick] = useState(0); // force re-render
  const [gameStarted, setGameStarted] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isCharging, setIsCharging] = useState(false);

  const rafRef = useRef(0);
  const keys = useRef(new Set<string>());
  const mouseDownAt = useRef(0);
  const gameOverRef = useRef(false);
  const timeoutIds = useRef<Array<ReturnType<typeof globalThis.setTimeout>>>([]);

  const scheduleTimeout = useCallback((callback: () => void, delay: number) => {
    const timeoutId = globalThis.setTimeout(() => {
      timeoutIds.current = timeoutIds.current.filter(id => id !== timeoutId);
      callback();
    }, delay);
    timeoutIds.current.push(timeoutId);
    return timeoutId;
  }, []);

  const clearAllTimeouts = useCallback(() => {
    for (const timeoutId of timeoutIds.current) {
      globalThis.clearTimeout(timeoutId);
    }
    timeoutIds.current = [];
  }, []);

  const scheduleBeamRemoval = useCallback((beamId: number, delay: number) => {
    scheduleTimeout(() => {
      G.beams = G.beams.filter(beam => beam.id !== beamId);
    }, delay);
  }, [scheduleTimeout]);

  const scheduleMissileLaunch = useCallback((targetId: number, delay: number) => {
    scheduleTimeout(() => {
      G.missiles.push({ id: id(), x: G.ship.x, y: G.ship.y, vx: 0, vy: 0, targetId, targetType: 'asteroid', born: Date.now() });
    }, delay);
  }, [scheduleTimeout]);

  const scheduleMissileLaunchToTarget = useCallback((targetId: number, targetType: Missile['targetType'], delay: number) => {
    scheduleTimeout(() => {
      G.missiles.push({ id: id(), x: G.ship.x, y: G.ship.y, vx: 0, vy: 0, targetId, targetType, born: Date.now() });
    }, delay);
  }, [scheduleTimeout]);

  const playWaveMusicCue = useCallback((_cueType: 'incoming' | 'start' | 'end', _waveNumber: number) => {
  }, []);

  useEffect(() => { setMounted(true); }, []);

  // ── takeDamage: runs synchronously in game loop ──
  const takeDamage = useCallback((amount: number) => {
    if (G.invincible) return;
    const now = Date.now();
    G.lastPlayerDamageAt = now;
    G.lastShieldRegenAt = now;
    let remainingDamage = amount;
    if (G.playerShield > 0) {
      const absorbed = Math.min(G.playerShield, remainingDamage);
      G.playerShield -= absorbed;
      remainingDamage -= absorbed;
    }
    if (remainingDamage <= 0) return;
    G.hp -= remainingDamage;
    if (G.hp <= 0) {
      if (G.deathsDefied > 0) {
        G.deathsDefied--;
        G.hp = 100;
        G.playerShield = 0;
        G.invincible = true;
        G.deathDefied = true;
        scheduleTimeout(() => {
          G.invincible = false;
          G.deathDefied = false;
        }, 3000);
      } else {
        G.running = false;
        G.hp = 0;
        gameOverRef.current = true;
        cancelAnimationFrame(rafRef.current);
        setGameOver(true);
      }
    }
  }, [scheduleTimeout]);

  // ── spawn helpers ──
  const spawnAsteroid = useCallback(() => {
    const side = Math.floor(Math.random() * 4);
    let x = 0, y = 0, sx = 0, sy = 0;
    const spd = 0.3 + Math.random() * 0.5;
    const ang = Math.random() * Math.PI * 2;
    const W = window.innerWidth, H = window.innerHeight;
    if (side === 0) { x = Math.random() * W; y = -50; sx = Math.cos(ang) * spd; sy = Math.abs(Math.sin(ang)) * spd; }
    else if (side === 1) { x = W + 50; y = Math.random() * H; sx = -Math.abs(Math.cos(ang)) * spd; sy = Math.sin(ang) * spd; }
    else if (side === 2) { x = Math.random() * W; y = H + 50; sx = Math.cos(ang) * spd; sy = -Math.abs(Math.sin(ang)) * spd; }
    else { x = -50; y = Math.random() * H; sx = Math.abs(Math.cos(ang)) * spd; sy = Math.sin(ang) * spd; }
    const spec = asteroidSpecFromRoll(Math.random());
    G.asteroids.push({ id: id(), x, y, size: spec.size, speedX: sx * spec.speedMul, speedY: sy * spec.speedMul, rotation: Math.random() * 360, rotationSpeed: (Math.random() - 0.5) * 2, hp: spec.hp, maxHp: spec.hp, type: spec.type });
  }, []);

  const spawnEnemyShip = useCallback((forcedType?: EnemyShip['type']) => {
    const side = Math.floor(Math.random() * 4);
    const W = window.innerWidth, H = window.innerHeight;
    let x = 0, y = 0;
    if (side === 0) { x = Math.random() * W; y = -50; }
    else if (side === 1) { x = W + 50; y = Math.random() * H; }
    else if (side === 2) { x = Math.random() * W; y = H + 50; }
    else { x = -50; y = Math.random() * H; }
    const roll = Math.random();
    let shipType: EnemyShip['type'] = forcedType ?? 'fighter';
    if (!forcedType) {
      if (roll < 0.2) shipType = 'sniper';
      else if (roll < 0.4) shipType = 'captain';
      else if (roll < 0.55) shipType = 'grenadier';
      else if (roll < 0.75) shipType = 'aggressive';
    }

    let hp = 10;
    let shield = 0;
    if (shipType === 'sniper') hp = 12;
    else if (shipType === 'captain') { hp = 14; shield = 20; }
    else if (shipType === 'grenadier') hp = 9;
    else if (shipType === 'aggressive') hp = 6;

    hp = Math.round(hp * 1.3);

    G.enemyShips.push({ id: id(), x, y, hp, maxHp: hp, shield, maxShield: shield, vx: 0, vy: 0, rotation: 0, lastShot: Date.now(), type: shipType, charging: false, chargeUntil: 0, freezeLeadMs: 0, aimX: 0, aimY: 0, shotX: 0, shotY: 0 });
  }, []);

  const spawnEnemyWave = useCallback((waveNumber: number) => {
    let fighterCount: number;
    let sniperCount: number;
    let aggressiveCount: number;
    let captainCount: number;
    let grenadierCount: number;

    if (waveNumber === 1) {
      fighterCount = 3;
      sniperCount = 1;
      aggressiveCount = 0;
      captainCount = 0;
      grenadierCount = 0;
    } else if (waveNumber === 2) {
      fighterCount = 4;
      sniperCount = 1;
      aggressiveCount = 0;
      captainCount = 0;
      grenadierCount = 0;
    } else if (waveNumber === 3) {
      fighterCount = 5;
      sniperCount = 1;
      aggressiveCount = 0;
      captainCount = 0;
      grenadierCount = 0;
    } else if (waveNumber === 4) {
      fighterCount = 6;
      sniperCount = 1;
      aggressiveCount = 1;
      captainCount = 0;
      grenadierCount = 1;
    } else if (waveNumber === 5) {
      fighterCount = 6;
      sniperCount = 2;
      aggressiveCount = 1;
      captainCount = 1;
      grenadierCount = 1;
    } else if (waveNumber === 6) {
      fighterCount = 6;
      sniperCount = 2;
      aggressiveCount = 2;
      captainCount = 1;
      grenadierCount = 1;
    } else {
      const rampLevel = 1 + Math.floor((waveNumber - 7) / 3.5);
      fighterCount = 6;
      sniperCount = Math.min(3, 2 + Math.floor(rampLevel / 1.2));
      aggressiveCount = Math.min(2, 1 + Math.floor(rampLevel / 2));
      captainCount = Math.min(2, 1 + Math.floor(rampLevel / 2));
      grenadierCount = Math.min(2, 1 + Math.floor(rampLevel / 2.5));
    }

    const waveShips: EnemyShip['type'][] = [];
    for (let i = 0; i < fighterCount; i++) waveShips.push('fighter');
    for (let i = 0; i < sniperCount; i++) waveShips.push('sniper');
    for (let i = 0; i < aggressiveCount; i++) waveShips.push('aggressive');
    for (let i = 0; i < captainCount; i++) waveShips.push('captain');
    for (let i = 0; i < grenadierCount; i++) waveShips.push('grenadier');

    for (let i = waveShips.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = waveShips[i];
      waveShips[i] = waveShips[j];
      waveShips[j] = temp;
    }

    let spawnGap = 500;
    if (waveNumber <= 3) {
      spawnGap = 500;
    } else if (waveNumber <= 6) {
      spawnGap = 420;
    } else {
      spawnGap = Math.max(280, 380 - Math.floor((waveNumber - 6) * 6));
    }
    G.waveSpawnEndsAt = Date.now() + Math.max(0, waveShips.length - 1) * spawnGap + 600;
    G.waveEndCuePlayed = false;

    waveShips.forEach((shipType, index) => {
      scheduleTimeout(() => {
        if (!G.running) return;
        spawnEnemyShip(shipType);
      }, index * spawnGap);
    });
  }, [scheduleTimeout, spawnEnemyShip]);

  // ── main game loop ──
  const loop = useCallback(() => {
    if (!G.running) return;
    const now = Date.now();
    const slow = G.timeSlow || G.deathDefied ? 0.3 : 1;
    const W = window.innerWidth, H = window.innerHeight;
    const ship = G.ship;

    // Ship movement
    const accel = 0.3, maxS = 3, fric = 0.92;
    if (keys.current.has('w') || keys.current.has('arrowup')) G.vel.y -= accel;
    if (keys.current.has('s') || keys.current.has('arrowdown')) G.vel.y += accel;
    if (keys.current.has('a') || keys.current.has('arrowleft')) G.vel.x -= accel;
    if (keys.current.has('d') || keys.current.has('arrowright')) G.vel.x += accel;
    G.vel.x *= fric; G.vel.y *= fric;
    const spd = Math.hypot(G.vel.x, G.vel.y);
    if (spd > maxS) { G.vel.x = G.vel.x / spd * maxS; G.vel.y = G.vel.y / spd * maxS; }
    ship.x = Math.max(30, Math.min(W - 30, ship.x + G.vel.x));
    ship.y = Math.max(30, Math.min(H - 30, ship.y + G.vel.y));

    // Player shield recharge (base shield only)
    if (now - G.lastPlayerDamageAt >= 4000 && G.playerShield < G.playerBaseShieldMax) {
      const elapsedSeconds = (now - G.lastShieldRegenAt) / 1000;
      if (elapsedSeconds > 0) {
        G.playerShield = Math.min(G.playerBaseShieldMax, G.playerShield + elapsedSeconds * 3);
        G.lastShieldRegenAt = now;
      }
    } else {
      G.lastShieldRegenAt = now;
    }

    // Power-up expiry
    G.activePowerUps = G.activePowerUps.filter(p => now < p.endTime);

    // Floating power-ups
    G.powerUps = G.powerUps.filter(p => {
      if (dist(p.x, p.y, ship.x, ship.y) < 30) {
        if (p.type === 'health') { G.hp = Math.min(100, G.hp + 30); }
        else if (p.type === 'shield') { G.playerShield = Math.min(G.playerBaseShieldMax, G.playerShield + 40); }
        else if (p.type === 'overshield') { G.playerShield = G.playerBaseShieldMax + G.playerOverShieldMax; }
        else {
          G.activePowerUps = G.activePowerUps.filter(a => a.type !== p.type && !(p.type === 'rapidfire' && a.type === 'spread') && !(p.type === 'spread' && a.type === 'rapidfire'));
          G.activePowerUps.push({ type: p.type, endTime: now + 30000, startTime: now });
        }
        spawnParticles(p.x, p.y, 12, puColor(p.type));
        return false;
      }
      return true;
    });

    // Asteroids
    G.asteroids = G.asteroids.map(a => ({
      ...a,
      x: a.x + a.speedX * slow,
      y: a.y + a.speedY * slow,
      rotation: a.rotation + a.rotationSpeed,
    })).filter(a => {
      if (a.x < -150 || a.x > W + 150 || a.y < -150 || a.y > H + 150) return false;
      // Ship collision
      if (!G.invincible && dist(a.x, a.y, ship.x, ship.y) < a.size + 20) {
        if (now - G.lastHit > 2000) {
          G.lastHit = now;
          takeDamage(20);
          spawnParticles(a.x, a.y, 12);
          if (!G.invincible) { G.invincible = true; scheduleTimeout(() => { G.invincible = false; }, 2000); }
        }
        return false;
      }
      return true;
    });

    // Bullets
    G.bullets = G.bullets.map(b => ({ ...b, x: b.x + b.vx, y: b.y + b.vy }))
      .filter(b => b.x > 0 && b.x < W && b.y > 0 && b.y < H);

    // Missiles
    G.missiles = G.missiles.map(m => {
      const prog = Math.min(1, (now - m.born) / 1000);
      const tgt = m.targetType === 'ship'
        ? G.enemyShips.find(s => s.id === m.targetId)
        : G.asteroids.find(a => a.id === m.targetId);
      if (tgt) {
        const ta = Math.atan2(tgt.y - m.y, tgt.x - m.x);
        const ca = Math.atan2(m.vy, m.vx);
        let diff = ta - ca;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const na = prog > 0.1 ? ca + diff * 0.15 : ta;
        const s = 3.4 * prog;
        return { ...m, x: m.x + Math.cos(na) * s, y: m.y + Math.sin(na) * s, vx: Math.cos(na) * s, vy: Math.sin(na) * s };
      }
      return { ...m, x: m.x + m.vx, y: m.y + m.vy };
    }).filter(m => m.x > -50 && m.x < W + 50 && m.y > -50 && m.y < H + 50);

    // Enemy ship vs asteroid collisions
    const usedAsteroids = new Set<number>();
    for (let si = G.enemyShips.length - 1; si >= 0; si--) {
      const enemyShip = G.enemyShips[si];
      for (let ai = G.asteroids.length - 1; ai >= 0; ai--) {
        const a = G.asteroids[ai];
        if (usedAsteroids.has(a.id)) continue;
        if (dist(enemyShip.x, enemyShip.y, a.x, a.y) < a.size + 20) {
          usedAsteroids.add(a.id);
          G.enemyShips[si] = damageEnemyShip(enemyShip, 6);
          G.asteroids[ai] = { ...a, hp: a.hp - 4 };
          spawnParticles(a.x, a.y, 8, '#ff8844');
          if (G.enemyShips[si].hp <= 0) {
            spawnParticles(enemyShip.x, enemyShip.y, 12, '#ff6600');
            G.score += enemyShipReward(enemyShip.type);
            if (Math.random() < enemyShipDropChance(enemyShip.type)) spawnPowerUp(enemyShip.x, enemyShip.y);
            if (shouldDropOverShield(enemyShip.type)) spawnOverShieldPowerUp(enemyShip.x, enemyShip.y);
            G.enemyShips.splice(si, 1);
            break;
          }
          if (G.asteroids[ai].hp <= 0) {
            spawnParticles(a.x, a.y, 12, asteroidColor(a.type));
            if (Math.random() < 0.2) spawnAsteroidPowerUp(a.x, a.y);
            G.asteroids.splice(ai, 1);
          }
          break;
        }
      }
    }

    // Particles
    G.particles = G.particles
      .map(p => ({ ...p, x: p.x + p.vx, y: p.y + p.vy, life: p.life - 0.02, vx: p.vx * 0.98, vy: p.vy * 0.98 }))
      .filter(p => p.life > 0);

    // Enemy ship AI
    G.enemyShips = G.enemyShips.map(s => {
      const dx = ship.x - s.x, dy = ship.y - s.y;
      const d = Math.hypot(dx, dy);
      const isSniper = s.type === 'sniper';
      const isCaptain = s.type === 'captain';
      const isAggressive = s.type === 'aggressive';
      const isGrenadier = s.type === 'grenadier';
      let target = 300;
      let maxSpd = 1.2;
      let accelToward = 0.1;
      let accelAway = 0.1;
      if (isSniper) {
        target = 600;
        maxSpd = 1;
        accelToward = 0.08;
        accelAway = 0.12;
      } else if (isCaptain) {
        target = 360;
        maxSpd = 0.75;
        accelToward = 0.07;
        accelAway = 0.07;
      } else if (isAggressive) {
        target = 130;
        maxSpd = 2.1;
        accelToward = 0.16;
        accelAway = 0.05;
      } else if (isGrenadier) {
        target = 420;
        maxSpd = 1;
        accelToward = 0.09;
        accelAway = 0.09;
      }
      let vx = s.vx, vy = s.vy;
      if (d > 0) {
        if (d > target + 50) {
          vx += dx / d * accelToward;
          vy += dy / d * accelToward;
        } else if (d < target - 50) {
          vx -= dx / d * accelAway;
          vy -= dy / d * accelAway;
        }
      }
      const sp = Math.hypot(vx, vy);
      if (sp > maxSpd) { vx = vx / sp * maxSpd; vy = vy / sp * maxSpd; }
      if (isSniper) {
        const chargeRemaining = s.chargeUntil - now;
        if (s.charging && chargeRemaining > 0 && chargeRemaining <= s.freezeLeadMs) {
          vx = 0;
          vy = 0;
        }
        if (s.charging && now >= s.chargeUntil) {
          G.enemyBeams.push({ id: id(), x1: s.shotX, y1: s.shotY, x2: s.aimX, y2: s.aimY, expiresAt: now + 180, type: 'sniper' });
          if (pointToSegmentDistance(ship.x, ship.y, s.shotX, s.shotY, s.aimX, s.aimY) < 26) {
            takeDamage(30);
            spawnParticles(ship.x, ship.y, 10, '#ff1177');
          }
          s = { ...s, lastShot: now, charging: false, freezeLeadMs: 0 };
        } else if (!s.charging && now - s.lastShot > 1700 && d > 450) {
          const chargeDuration = 1200;
          const freezeLeadMs = 250;
          G.enemyBeams.push({ id: id(), x1: s.x, y1: s.y, x2: ship.x, y2: ship.y, expiresAt: now + chargeDuration, type: 'telegraph' });
          s = { ...s, charging: true, chargeUntil: now + chargeDuration, freezeLeadMs, aimX: ship.x, aimY: ship.y, shotX: s.x, shotY: s.y };
        }
      } else if (isCaptain && now - s.lastShot > 280 && d < 560) {
        const a = Math.atan2(dy, dx);
        G.enemyBullets.push({ id: id(), x: s.x, y: s.y, vx: Math.cos(a) * 5.4, vy: Math.sin(a) * 5.4, damage: 4, color: '#7dd3fc' });
        s = { ...s, lastShot: now };
      } else if (isAggressive && now - s.lastShot > 850 && d < 340) {
        const baseA = Math.atan2(dy, dx);
        const spread = 0.22;
        for (let i = -2; i <= 2; i++) {
          const a = baseA + i * spread;
          G.enemyBullets.push({ id: id(), x: s.x, y: s.y, vx: Math.cos(a) * 4.5, vy: Math.sin(a) * 4.5, damage: 2, color: '#ff9933' });
        }
        s = { ...s, lastShot: now };
      } else if (isGrenadier && now - s.lastShot > 5000 + Math.random() * 1000 && d < 550) {
        const a = Math.atan2(dy, dx);
        const speed = 2.8;
        const trackDuration = 2000 + Math.random() * 1000;
        G.enemyMissiles.push({ id: id(), x: s.x, y: s.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, born: now, trackUntil: now + trackDuration });
        s = { ...s, lastShot: now };
      } else if (!isSniper && !isCaptain && !isAggressive && !isGrenadier && now - s.lastShot > 500 && d < 500) {
        const a = Math.atan2(dy, dx);
        G.enemyBullets.push({ id: id(), x: s.x, y: s.y, vx: Math.cos(a) * 4, vy: Math.sin(a) * 4, damage: 3, color: '#ff4444' });
        s = { ...s, lastShot: now };
      }
      return { ...s, x: s.x + vx, y: s.y + vy, vx, vy, rotation: Math.atan2(dy, dx) * 180 / Math.PI + 90 };
    }).filter(s => s.x > -200 && s.x < W + 200 && s.y > -200 && s.y < H + 200);

    // Enemy beams (visual lifetime)
    G.enemyBeams = G.enemyBeams.filter(beam => now < beam.expiresAt);

    if (!G.waveEndCuePlayed && G.wave > 0 && now >= G.waveSpawnEndsAt && G.enemyShips.length === 0) {
      playWaveMusicCue('end', G.wave);
      G.waveEndCuePlayed = true;
    }

    // Enemy bullets
    G.enemyBullets = G.enemyBullets
      .map(b => ({ ...b, x: b.x + b.vx, y: b.y + b.vy }))
      .filter(b => {
        if (b.x < 0 || b.x > W || b.y < 0 || b.y > H) return false;
        if (!G.invincible && dist(b.x, b.y, ship.x, ship.y) < 20) {
          takeDamage(b.damage);
          spawnParticles(ship.x, ship.y, 6, '#ff4444');
          return false;
        }
        return true;
      });

    // Enemy missiles (homing)
    G.enemyMissiles = G.enemyMissiles.map(m => {
      let newVx = m.vx;
      let newVy = m.vy;
      if (now < m.trackUntil) {
        const dx = ship.x - m.x;
        const dy = ship.y - m.y;
        const targetAngle = Math.atan2(dy, dx);
        const currentAngle = Math.atan2(m.vy, m.vx);
        let angleDiff = targetAngle - currentAngle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        const turnRate = 0.08 + Math.random() * 0.04;
        const jitter = (Math.random() - 0.5) * 0.1;
        const newAngle = currentAngle + angleDiff * turnRate + jitter;
        const speed = Math.hypot(m.vx, m.vy);
        newVx = Math.cos(newAngle) * speed;
        newVy = Math.sin(newAngle) * speed;
      }
      return {
        ...m,
        x: m.x + newVx,
        y: m.y + newVy,
        vx: newVx,
        vy: newVy,
      };
    }).filter(m => {
      if (m.x < -100 || m.x > W + 100 || m.y < -100 || m.y > H + 100) return false;
      if (!G.invincible && dist(m.x, m.y, ship.x, ship.y) < 22) {
        takeDamage(20);
        spawnParticles(ship.x, ship.y, 10, '#ff8800');
        return false;
      }
      return true;
    });

    // ── BULLET vs ENEMY SHIPS ──
    // Both arrays are plain JS arrays in G — no React state involved
    const usedBullets = new Set<number>();
    for (let si = G.enemyShips.length - 1; si >= 0; si--) {
      const ship2 = G.enemyShips[si];
      for (let bi = G.bullets.length - 1; bi >= 0; bi--) {
        const b = G.bullets[bi];
        if (usedBullets.has(b.id)) continue;
        if (dist(b.x, b.y, ship2.x, ship2.y) < 30) {
          usedBullets.add(b.id);
          G.enemyShips[si] = damageEnemyShip(ship2, 2);
          if (ship2.shield > 0) {
            spawnParticles(ship2.x, ship2.y, 4, '#66ccff');
          }
          if (G.enemyShips[si].hp <= 0) {
            spawnParticles(ship2.x, ship2.y, 15, '#ff6600');
            G.score += enemyShipReward(ship2.type);
            if (Math.random() < enemyShipDropChance(ship2.type)) spawnPowerUp(ship2.x, ship2.y);
            if (shouldDropOverShield(ship2.type)) spawnOverShieldPowerUp(ship2.x, ship2.y);
            G.enemyShips.splice(si, 1);
          }
          break;
        }
      }
    }
    G.bullets = G.bullets.filter(b => !usedBullets.has(b.id));

    // ── BULLET vs ASTEROIDS ──
    const usedBullets2 = new Set<number>();
    for (let ai = G.asteroids.length - 1; ai >= 0; ai--) {
      const a = G.asteroids[ai];
      for (let bi = G.bullets.length - 1; bi >= 0; bi--) {
        const b = G.bullets[bi];
        if (usedBullets2.has(b.id)) continue;
        if (dist(b.x, b.y, a.x, a.y) < a.size) {
          usedBullets2.add(b.id);
          G.asteroids[ai] = { ...a, hp: a.hp - 2 };
          if (G.asteroids[ai].hp <= 0) {
            spawnParticles(a.x, a.y, 12, asteroidColor(a.type));
            G.score += Math.floor(a.size * (a.type === 'armored' ? 2 : 1));
            if (Math.random() < 0.2) spawnAsteroidPowerUp(a.x, a.y);
            if (a.type === 'splitting') {
              for (let k = 0; k < 3; k++) {
                const ang = (Math.PI * 2 * k) / 3 + Math.random() * 0.5;
                const s = 1 + Math.random() * 1.5;
                G.asteroids.push({ id: id(), x: a.x, y: a.y, size: 20, speedX: Math.cos(ang) * s, speedY: Math.sin(ang) * s, rotation: Math.random() * 360, rotationSpeed: (Math.random() - 0.5) * 3, hp: 1, maxHp: 1, type: 'fast' });
              }
            }
            G.asteroids.splice(ai, 1);
          } else {
            spawnParticles(a.x, a.y, 3);
          }
          break;
        }
      }
    }
    G.bullets = G.bullets.filter(b => !usedBullets2.has(b.id));

    // ── MISSILE vs ASTEROIDS ──
    const usedMissiles = new Set<number>();
    for (let ai = G.asteroids.length - 1; ai >= 0; ai--) {
      const a = G.asteroids[ai];
      for (let mi = G.missiles.length - 1; mi >= 0; mi--) {
        const m = G.missiles[mi];
        if (usedMissiles.has(m.id)) continue;
        if (dist(m.x, m.y, a.x, a.y) < a.size + 5) {
          usedMissiles.add(m.id);
          spawnParticles(m.x, m.y, 10, '#ffaa00');
          G.asteroids[ai] = { ...a, hp: a.hp - 10 };
          if (G.asteroids[ai].hp <= 0) {
            spawnParticles(a.x, a.y, 15, asteroidColor(a.type));
            G.score += Math.floor(a.size * (a.type === 'armored' ? 2 : 1));
            if (Math.random() < 0.2) spawnAsteroidPowerUp(a.x, a.y);
            G.asteroids.splice(ai, 1);
          }
          break;
        }
      }
    }
    G.missiles = G.missiles.filter(m => !usedMissiles.has(m.id));

    // ── MISSILE vs ENEMY SHIPS ──
    const usedMissilesOnShips = new Set<number>();
    for (let si = G.enemyShips.length - 1; si >= 0; si--) {
      const enemyShip = G.enemyShips[si];
      for (let mi = G.missiles.length - 1; mi >= 0; mi--) {
        const missile = G.missiles[mi];
        if (usedMissilesOnShips.has(missile.id)) continue;
        if (dist(missile.x, missile.y, enemyShip.x, enemyShip.y) < 26) {
          usedMissilesOnShips.add(missile.id);
          spawnParticles(missile.x, missile.y, 10, '#ffaa00');
          G.enemyShips[si] = damageEnemyShip(enemyShip, 10);
          if (enemyShip.shield > 0) {
            spawnParticles(enemyShip.x, enemyShip.y, 6, '#66ccff');
          }
          if (G.enemyShips[si].hp <= 0) {
            spawnParticles(enemyShip.x, enemyShip.y, 15, '#ff6600');
            G.score += enemyShipReward(enemyShip.type);
            if (Math.random() < enemyShipDropChance(enemyShip.type)) spawnPowerUp(enemyShip.x, enemyShip.y);
            if (shouldDropOverShield(enemyShip.type)) spawnOverShieldPowerUp(enemyShip.x, enemyShip.y);
            G.enemyShips.splice(si, 1);
          }
          break;
        }
      }
    }
    G.missiles = G.missiles.filter(m => !usedMissilesOnShips.has(m.id));

    // ── BEAM vs ASTEROIDS ──
    for (const beam of G.beams) {
      const dx = beam.targetX - ship.x, dy = beam.targetY - ship.y;
      const blen = Math.hypot(dx, dy);
      if (blen === 0) continue;
      const bw = hasPU('spread') ? 10 + ((beam.damage - 11) / 33) * 55 : 10;
      for (let ai = G.asteroids.length - 1; ai >= 0; ai--) {
        const a = G.asteroids[ai];
        const ax = a.x - ship.x, ay = a.y - ship.y;
        const proj = (ax * dx + ay * dy) / (blen ** 2);
        if (proj < 0 || proj > 1) continue;
        const cx = ship.x + proj * dx, cy = ship.y + proj * dy;
        if (dist(a.x, a.y, cx, cy) < a.size + bw) {
          G.asteroids[ai] = { ...a, hp: a.hp - beam.damage };
          if (G.asteroids[ai].hp <= 0) {
            spawnParticles(a.x, a.y, 12, asteroidColor(a.type));
            G.score += Math.floor(a.size * 2 * (a.type === 'armored' ? 2 : 1));
            if (Math.random() < 0.2) spawnAsteroidPowerUp(a.x, a.y);
            G.asteroids.splice(ai, 1);
          }
        }
      }

      // Beam vs enemy ships
      for (let si = G.enemyShips.length - 1; si >= 0; si--) {
        const enemyShip = G.enemyShips[si];
        const ex = enemyShip.x - ship.x;
        const ey = enemyShip.y - ship.y;
        const proj = (ex * dx + ey * dy) / (blen ** 2);
        if (proj < 0 || proj > 1) continue;
        const cx = ship.x + proj * dx;
        const cy = ship.y + proj * dy;
        const shipRadius = 20;
        if (dist(enemyShip.x, enemyShip.y, cx, cy) < shipRadius + bw) {
          G.enemyShips[si] = damageEnemyShip(enemyShip, beam.damage);
          spawnParticles(enemyShip.x, enemyShip.y, 4, enemyShip.shield > 0 ? '#66ccff' : '#ff8844');
          if (G.enemyShips[si].hp <= 0) {
            spawnParticles(enemyShip.x, enemyShip.y, 15, '#ff6600');
            G.score += enemyShipReward(enemyShip.type);
            if (Math.random() < enemyShipDropChance(enemyShip.type)) spawnPowerUp(enemyShip.x, enemyShip.y);
            if (shouldDropOverShield(enemyShip.type)) spawnOverShieldPowerUp(enemyShip.x, enemyShip.y);
            G.enemyShips.splice(si, 1);
          }
        }
      }
    }

    // Trigger re-render
    setTick(t => t + 1);
    rafRef.current = requestAnimationFrame(loop);
  }, [takeDamage, spawnAsteroid, spawnEnemyShip, scheduleTimeout, playWaveMusicCue]);

  // Input
  useEffect(() => {
    const onMove = (e: MouseEvent) => { G.mouse.x = e.clientX; G.mouse.y = e.clientY; };
    const onDown = (e: MouseEvent) => {
      if (!G.running) return;
      mouseDownAt.current = Date.now();
      setIsCharging(true);
    };
    const onUp = (e: MouseEvent) => {
      if (!G.running) return;
      if (mouseDownAt.current <= 0) return;
      const hold = (Date.now() - mouseDownAt.current) / 1000;
      const hasRapid = hasPU('rapidfire');
      const hasSpread = hasPU('spread');
      setIsCharging(false);
      mouseDownAt.current = 0;
      if (hold < 0.1) {
        // Quick shot
        const now = Date.now();
        let rate = 250;
        if (hasRapid) {
          const rapidfirePowerUp = G.activePowerUps.find(p => p.type === 'rapidfire');
          if (rapidfirePowerUp) {
            rate = Math.max(10, 100 - Math.min(1, (now - rapidfirePowerUp.startTime) / 15000) * 90);
          }
        } else if (hasSpread) {
          rate = 150;
        }
        if (now - G.lastShot < rate) return;
        G.lastShot = now;
        const dx = e.clientX - G.ship.x, dy = e.clientY - G.ship.y;
        const count = hasSpread ? 3 : 1;
        for (let i = 0; i < count; i++) {
          const spreadOffset = hasSpread ? (i - 1) * 0.3 : 0;
          const ang = Math.atan2(dy, dx) + spreadOffset;
          G.bullets.push({ id: id(), x: G.ship.x, y: G.ship.y, vx: Math.cos(ang) * 6, vy: Math.sin(ang) * 6 });
        }
      } else {
        // Beam
        let dmg = Math.min(10, 2 + hold * 8);
        if (hasRapid) {
          dmg = Math.min(8, 2 + hold * 12);
        } else if (hasSpread) {
          dmg = 11 * (1 + Math.min(1, hold / 3) * 3);
        }
        const bid = id();
        G.beams.push({ id: bid, targetX: e.clientX, targetY: e.clientY, damage: dmg });
        const count = hasRapid ? 3 : 1;
        const baseDuration = hasRapid ? 120 : 500;
        for (let i = 0; i < count; i++) {
          const delay = hasRapid ? baseDuration + i * 150 : baseDuration;
          scheduleBeamRemoval(bid, delay);
        }
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      keys.current.add(e.key.toLowerCase());
      if (e.key.toLowerCase() === 'e') {
        const now = Date.now();
        if (now > G.timeSlowCooldown) {
          G.timeSlow = true;
          G.timeSlowCooldown = now + 10000;
          scheduleTimeout(() => { G.timeSlow = false; }, 3500);
        }
      }
      if (e.key.toLowerCase() === 'q') {
        const now = Date.now();
        if (now > G.missileCooldown) {
          G.missileCooldown = now + 5000;
          const shipTargets = [...G.enemyShips].sort(() => Math.random() - 0.5).slice(0, 2);
          const asteroidTargets = [...G.asteroids].sort(() => Math.random() - 0.5).slice(0, 3);
          const targets: Array<{ id: number; type: Missile['targetType'] }> = [];
          shipTargets.forEach(t => targets.push({ id: t.id, type: 'ship' }));
          asteroidTargets.forEach(t => targets.push({ id: t.id, type: 'asteroid' }));
          targets.sort(() => Math.random() - 0.5);
          for (let i = 0; i < targets.length; i++) {
            scheduleMissileLaunchToTarget(targets[i].id, targets[i].type, i * 100);
          }
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    globalThis.addEventListener('mousemove', onMove);
    globalThis.addEventListener('mousedown', onDown);
    globalThis.addEventListener('mouseup', onUp);
    globalThis.addEventListener('keydown', onKeyDown);
    globalThis.addEventListener('keyup', onKeyUp);
    return () => {
      globalThis.removeEventListener('mousemove', onMove);
      globalThis.removeEventListener('mousedown', onDown);
      globalThis.removeEventListener('mouseup', onUp);
      globalThis.removeEventListener('keydown', onKeyDown);
      globalThis.removeEventListener('keyup', onKeyUp);
    };
  }, [scheduleTimeout, scheduleBeamRemoval, scheduleMissileLaunch, scheduleMissileLaunchToTarget]);

  // Spawners
  useEffect(() => {
    if (!gameStarted || gameOver) return;
    const startupAsteroidTimeouts: Array<ReturnType<typeof globalThis.setTimeout>> = [];
    const waveScheduleTimeouts: Array<ReturnType<typeof globalThis.setTimeout>> = [];
    let cancelled = false;
    for (let i = 0; i < 3; i++) {
      startupAsteroidTimeouts.push(globalThis.setTimeout(() => spawnAsteroid(), i * 800));
    }
    const ia = setInterval(() => spawnAsteroid(), 3000);

    const WAVE_INTERVAL_MS = 30000;
    const WAVE_WARNING_MS = 3000;

    const scheduleNextWave = (delayMs: number) => {
      if (cancelled) return;
      const nextWave = G.wave + 1;
      const warningTimeout = globalThis.setTimeout(() => {
        if (!cancelled && G.running) {
          playWaveMusicCue('incoming', nextWave);
        }
      }, Math.max(0, delayMs - WAVE_WARNING_MS));
      waveScheduleTimeouts.push(warningTimeout);

      const startTimeout = globalThis.setTimeout(() => {
        if (cancelled || !G.running) return;
        G.wave += 1;
        playWaveMusicCue('start', G.wave);
        spawnEnemyWave(G.wave);
        scheduleNextWave(WAVE_INTERVAL_MS);
      }, delayMs);
      waveScheduleTimeouts.push(startTimeout);
    };

    scheduleNextWave(4000);

    return () => {
      cancelled = true;
      clearInterval(ia);
      for (const timeoutId of startupAsteroidTimeouts) {
        globalThis.clearTimeout(timeoutId);
      }
      for (const timeoutId of waveScheduleTimeouts) {
        globalThis.clearTimeout(timeoutId);
      }
    };
  }, [gameStarted, gameOver, spawnAsteroid, spawnEnemyWave, playWaveMusicCue]);

  useEffect(() => {
    return () => {
      clearAllTimeouts();
    };
  }, [clearAllTimeouts]);

  // Start loop
  useEffect(() => {
    if (gameStarted && !gameOver) {
      rafRef.current = requestAnimationFrame(loop);
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [gameStarted, gameOver, loop]);

  const startGame = () => {
    clearAllTimeouts();
    // Reset G
    G.asteroids = []; G.bullets = []; G.enemyBullets = []; G.enemyShips = [];
    G.enemyBeams = [];
    G.particles = []; G.powerUps = []; G.activePowerUps = []; G.beams = []; G.missiles = [];
    G.ship = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    G.vel = { x: 0, y: 0 };
    G.hp = 100; G.playerShield = G.playerBaseShieldMax; G.deathsDefied = 1; G.score = 0;
    G.invincible = false; G.deathDefied = false; G.timeSlow = false;
    G.timeSlowCooldown = 0; G.missileCooldown = 0;
    G.lastShot = 0; G.lastHit = 0;
    G.lastPlayerDamageAt = Date.now();
    G.lastShieldRegenAt = G.lastPlayerDamageAt;
    G.wave = 0;
    G.waveSpawnEndsAt = 0;
    G.waveEndCuePlayed = true;
    G.firstCaptainOverShieldDropped = false;
    G.running = true;
    gameOverRef.current = false;
    keys.current.clear();
    mouseDownAt.current = 0;
    setGameOver(false);
    setGameStarted(true);
    setIsCharging(false);
  };

  const resetGame = () => {
    cancelAnimationFrame(rafRef.current);
    clearAllTimeouts();
    G.running = false;
    setGameStarted(false);
    setGameOver(false);
    setIsCharging(false);
  };

  if (!mounted) return null;

  // Read from G for rendering (tick forces re-render each frame)
  const ship = G.ship;
  const mouse = G.mouse;
  const hpDisplayColor = hpColor(G.hp, 100);
  const gameOverMessage = scoreMessage(G.score);
  const nowTs = Date.now();
  const rapidActive = hasPU('rapidfire');
  const spreadActive = hasPU('spread');
  const deathDefiedAvailable = G.deathsDefied > 0;
  const deathDefiedDotColor = deathDefiedAvailable ? '#FFD700' : '#333';
  const deathDefiedDotShadow = deathDefiedAvailable ? '0 0 10px #FFD700,0 0 20px #FFA500' : 'none';
  const deathDefiedDotBorder = deathDefiedAvailable ? '#FFD700' : '#555';
  const shipOpacity = G.invincible ? 0.5 : 1;
  const shipAnimation = G.invincible ? 'flash .2s infinite' : 'none';
  const hasOverShield = G.playerShield > G.playerBaseShieldMax;
  const shieldAuraColor = hasOverShield ? '#00ff66' : '#00ccff';
  const shieldFillColor = shieldAuraColor;
  let chargeColor = 'cyan';
  let chargeDurationMs = 1000;
  if (rapidActive) {
    chargeColor = '#ff0';
    chargeDurationMs = 500;
  } else if (spreadActive) {
    chargeColor = '#f0f';
    chargeDurationMs = 3000;
  }

  return (
    <div className="w-screen h-screen relative overflow-hidden bg-black" style={{ cursor: 'none' }} data-tick={tick}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.5} }
        @keyframes flash { 0%,100%{opacity:0.3}50%{opacity:1} }
        @keyframes sniperFlash { 0%,100%{opacity:.2}50%{opacity:1} }
        @keyframes ddPulse { 0%{opacity:0.5}100%{opacity:1} }
        @keyframes ddText { 0%{opacity:0;transform:translate(-50%,-50%) scale(0.6)} 15%{opacity:1;transform:translate(-50%,-50%) scale(1.15)} 30%{transform:translate(-50%,-50%) scale(1)} 70%{opacity:1} 100%{opacity:0;transform:translate(-50%,-60%)} }
      `}</style>

      <div className="absolute inset-0 z-0">
        <PixelSnow color="#ffffff" flakeSize={0.01} minFlakeSize={1.25} pixelResolution={200} speed={1.25} depthFade={8} farPlane={20} brightness={0.7} gamma={0.4545} density={0.3} variant="snowflake" direction={125} />
      </div>

      {/* Death Defied effect */}
      {G.deathDefied && (
        <>
          <div className="absolute inset-0 z-50 pointer-events-none" style={{ background: 'radial-gradient(ellipse at center,rgba(255,215,0,.45) 0%,rgba(255,165,0,.2) 40%,transparent 70%)', animation: 'ddPulse .6s ease-out infinite alternate' }} />
          <div className="absolute inset-0 z-50 pointer-events-none" style={{ boxShadow: 'inset 0 0 120px 40px rgba(255,200,0,.35)' }} />
          <div className="absolute top-1/2 left-1/2 z-50 pointer-events-none" style={{ animation: 'ddText 3s ease-out forwards' }}>
            <div style={{ fontFamily: 'monospace', fontSize: 52, fontWeight: 'bold', color: '#FFD700', textShadow: '0 0 30px #FFD700,0 0 60px #FFA500,0 0 100px #FF8C00', letterSpacing: 6, whiteSpace: 'nowrap' }}>DEATH DEFIED</div>
          </div>
        </>
      )}

      {/* Time slow effect */}
      {G.timeSlow && (
        <>
          <div className="absolute inset-0 z-40 pointer-events-none" style={{ mixBlendMode: 'saturation', backgroundColor: 'rgba(128,128,128,.8)', animation: 'flash .5s ease-in-out' }} />
          <svg className="absolute inset-0 z-40 w-full h-full pointer-events-none" style={{ opacity: .3 }}>
            {TIME_SLOW_ANGLES.map((angleDeg) => {
              const a = angleDeg * Math.PI / 180;
              const len = Math.max(window.innerWidth, window.innerHeight);
              return <line key={angleDeg} x1={window.innerWidth/2} y1={window.innerHeight/2} x2={window.innerWidth/2+Math.cos(a)*len} y2={window.innerHeight/2+Math.sin(a)*len} stroke="rgba(200,200,200,.3)" strokeWidth="1" style={{ filter: 'blur(2px)' }} />;
            })}
          </svg>
        </>
      )}

      {/* HUD */}
      {gameStarted && !gameOver && (
        <>
          <div className="absolute top-5 left-5 z-10 font-mono text-white" style={{ textShadow: '2px 2px 4px rgba(0,0,0,.8)' }}>
            <div className="text-xl">Score: {G.score}</div>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-sm" style={{ color: '#888' }}>DEATH DEFIED</span>
              <div style={{ width: 18, height: 18, borderRadius: '50%', backgroundColor: deathDefiedDotColor, boxShadow: deathDefiedDotShadow, border: `2px solid ${deathDefiedDotBorder}`, transition: 'all .3s' }} />
            </div>
            <div className="mt-2">
              <div className="text-sm mb-1" style={{ color: hpDisplayColor }}>HP: {G.hp}/100</div>
              <div style={{ width: 180, height: 8, background: '#333', borderRadius: 4, border: '1px solid #666' }}>
                <div style={{ width: `${G.hp}%`, height: '100%', borderRadius: 4, backgroundColor: hpDisplayColor, transition: 'width .2s,background-color .3s', boxShadow: `0 0 6px ${hpDisplayColor}` }} />
              </div>
            </div>
            <div className="mt-2">
              <div className="text-sm mb-1" style={{ color: shieldFillColor }}>SHIELD: {Math.ceil(G.playerShield)}/{G.playerBaseShieldMax + G.playerOverShieldMax}</div>
              <div style={{ width: 180, height: 6, background: '#223', borderRadius: 4, border: '1px solid #355' }}>
                <div style={{ width: `${(G.playerShield / (G.playerBaseShieldMax + G.playerOverShieldMax)) * 100}%`, height: '100%', borderRadius: 4, backgroundColor: shieldFillColor, transition: 'width .2s,background-color .3s', boxShadow: `0 0 6px ${shieldFillColor}` }} />
              </div>
            </div>
          </div>

          <div className="absolute top-5 right-5 z-10 font-mono text-sm text-white" style={{ textShadow: '2px 2px 4px rgba(0,0,0,.8)' }}>
            {G.activePowerUps.filter(p => p.type !== 'shield' && p.type !== 'overshield').map((p) => (
              <div key={`${p.type}-${p.endTime}`} style={{ color: puColor(p.type), marginBottom: 5 }}>{p.type.toUpperCase()}: {Math.ceil((p.endTime - nowTs) / 1000)}s</div>
            ))}
          </div>

          <div className="absolute z-10 font-mono text-sm text-white" style={{ top: 130, right: 20, textShadow: '2px 2px 4px rgba(0,0,0,.8)' }}>
            <div className="mb-2 flex gap-2 items-center">
              <span style={{ color: '#0ff' }}>E - Time Slow:</span>
              {nowTs < G.timeSlowCooldown ? <span style={{ color: '#f66' }}>{Math.ceil((G.timeSlowCooldown - nowTs) / 1000)}s</span> : <span style={{ color: '#0f0' }}>READY</span>}
            </div>
            <div className="flex gap-2 items-center">
              <span style={{ color: '#f80' }}>Q - Missiles:</span>
              {nowTs < G.missileCooldown ? <span style={{ color: '#f66' }}>{Math.ceil((G.missileCooldown - nowTs) / 1000)}s</span> : <span style={{ color: '#0f0' }}>READY</span>}
            </div>
          </div>

          <div className="absolute bottom-5 left-5 z-10 font-mono text-sm text-white opacity-70">
            <div>WASD / Arrows: Move</div>
            <div style={{ color: '#ff0' }}>Click: Shoot &nbsp; <span style={{ color: '#0ff' }}>Hold: Beam</span></div>
            <div className="mt-1" style={{ color: '#f44' }}>Watch out for enemy ships!</div>
          </div>
        </>
      )}

      {/* Start screen */}
      {!gameStarted && !gameOver && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center text-white font-mono text-center cursor-default">
          <h1 className="text-6xl mb-5" style={{ textShadow: '0 0 20px cyan,0 0 40px cyan', letterSpacing: 5 }}>ASTEROID DEFENDER</h1>
          <div className="text-lg mb-10 text-gray-400 leading-loose">
            <p>WASD / Arrows to move &nbsp;|&nbsp; Mouse to aim</p>
            <p><span style={{ color: '#ff0' }}>Click: shoot</span> &nbsp;|&nbsp; <span style={{ color: '#0ff' }}>Hold: beam</span></p>
            <p className="mt-3" style={{ color: '#f44' }}>Enemy ships hunt and shoot you!</p>
            <p className="mt-1" style={{ color: '#FFD700', fontSize: 14 }}>1× Death Defied — survive your first death!</p>
          </div>
          <button onClick={startGame} className="px-12 py-5 text-2xl bg-cyan-400 text-black rounded-lg font-bold cursor-pointer" style={{ boxShadow: '0 0 20px cyan' }}
            onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.1)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}>
            START GAME
          </button>
        </div>
      )}

      {/* Game over */}
      {gameOver && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center text-white font-mono text-center cursor-default">
          <h1 className="text-6xl mb-5 text-red-500" style={{ textShadow: '0 0 20px #f44,0 0 40px #f44' }}>GAME OVER</h1>
          <p className="text-3xl mb-2 text-cyan-400" style={{ textShadow: '0 0 10px cyan' }}>Score: {G.score}</p>
          <p className="text-lg mb-10 text-gray-400">{gameOverMessage}</p>
          <button onClick={resetGame} className="px-12 py-5 text-2xl bg-white text-black rounded-lg font-bold cursor-pointer" style={{ boxShadow: '0 0 20px white' }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'cyan'; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'white'; }}>
            PLAY AGAIN
          </button>
        </div>
      )}

      {/* Game objects */}
      {gameStarted && !gameOver && (
        <div className="absolute inset-0 z-[1] pointer-events-none">
          {/* Ship */}
          <div className="absolute" style={{ left: ship.x, top: ship.y, transform: `translate(-50%,-50%) rotate(${Math.atan2(mouse.y - ship.y, mouse.x - ship.x)}rad)`, opacity: shipOpacity, animation: shipAnimation }}>
            <svg width="40" height="40" viewBox="0 0 40 40">
              {G.playerShield > 0 && <circle cx="20" cy="20" r="17" fill="none" stroke={shieldAuraColor} strokeWidth="2" opacity="0.75" />}
              <polygon points="30,20 10,10 10,30" fill="white" stroke={G.invincible ? '#f44' : 'cyan'} strokeWidth="2" />
            </svg>
          </div>

          {/* Enemy ships */}
          {G.enemyShips.map(s => (
            <div key={s.id} className="absolute" style={{ left: s.x, top: s.y, transform: `translate(-50%,-50%) rotate(${s.rotation}deg)` }}>
              <svg width="36" height="36" viewBox="0 0 36 36">
                {s.type === 'sniper' ? (
                  <>
                    <polygon points="18,1 30,24 24,30 12,30 6,24" fill="rgba(120,0,120,.9)" stroke="#ff66ff" strokeWidth="2" />
                    <line x1="18" y1="1" x2="18" y2="-7" stroke="#ff66ff" strokeWidth="2" />
                    {s.charging && <circle cx="18" cy="18" r="4" fill="#ffd1f0" opacity="0.9" />}
                    {s.charging && s.chargeUntil > nowTs && s.chargeUntil - nowTs <= 500 && (
                      <circle cx="18" cy="18" r="15" fill="none" stroke="#ff88ff" strokeWidth="2" style={{ animation: 'sniperFlash .2s linear infinite' }} />
                    )}
                  </>
                ) : s.type === 'captain' ? (
                  <>
                    <polygon points="18,2 31,10 31,26 18,34 5,26 5,10" fill="rgba(30,110,200,.85)" stroke="#7dd3fc" strokeWidth="2" />
                    <line x1="18" y1="2" x2="18" y2="-6" stroke="#7dd3fc" strokeWidth="2" />
                    {s.shield > 0 && <circle cx="18" cy="18" r="15" fill="none" stroke="#67e8f9" strokeWidth="2" opacity="0.8" />}
                  </>
                ) : s.type === 'aggressive' ? (
                  <>
                    <polygon points="18,2 34,30 2,30" fill="rgba(255,120,30,.9)" stroke="#ff9933" strokeWidth="2" />
                    <line x1="18" y1="2" x2="18" y2="-6" stroke="#ffcc66" strokeWidth="2" />
                  </>
                ) : s.type === 'grenadier' ? (
                  <>
                    <polygon points="18,4 28,12 28,24 18,32 8,24 8,12" fill="rgba(100,150,50,.9)" stroke="#88cc44" strokeWidth="2" />
                    <line x1="18" y1="4" x2="18" y2="-5" stroke="#88cc44" strokeWidth="2" />
                    <circle cx="18" cy="18" r="3" fill="#ddff88" opacity="0.7" />
                  </>
                ) : (
                  <polygon points="18,2 34,34 18,26 2,34" fill="rgba(180,0,0,.85)" stroke="#f44" strokeWidth="2" />
                )}
              </svg>
              <div style={{ position: 'absolute', bottom: -8, left: '50%', transform: 'translateX(-50%)', width: 36, height: 3, background: '#333', borderRadius: 2 }}>
                <div style={{ width: `${s.hp / s.maxHp * 100}%`, height: '100%', background: s.type === 'sniper' ? '#f6f' : s.type === 'captain' ? '#7dd3fc' : s.type === 'aggressive' ? '#ff9933' : s.type === 'grenadier' ? '#88cc44' : '#f44', borderRadius: 2 }} />
              </div>
              {s.maxShield > 0 && (
                <div style={{ position: 'absolute', bottom: -13, left: '50%', transform: 'translateX(-50%)', width: 36, height: 2, background: '#223', borderRadius: 2 }}>
                  <div style={{ width: `${(s.shield / s.maxShield) * 100}%`, height: '100%', background: '#67e8f9', borderRadius: 2 }} />
                </div>
              )}
              <div style={{ position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)', fontSize: 9, fontFamily: 'monospace', color: s.type === 'captain' ? '#7dd3fc' : s.type === 'aggressive' ? '#ffb366' : s.type === 'sniper' ? '#ff88ff' : s.type === 'grenadier' ? '#99dd55' : '#ff6666' }}>
                {s.type.toUpperCase()}
              </div>
            </div>
          ))}

          {/* Enemy beams */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            {G.enemyBeams.map(beam => (
              <g key={beam.id}>
                <line x1={beam.x1} y1={beam.y1} x2={beam.x2} y2={beam.y2} stroke={beam.type === 'telegraph' ? '#ff66ff' : '#ff1177'} strokeWidth={beam.type === 'telegraph' ? 3 : 6} opacity={beam.type === 'telegraph' ? '.45' : '.35'} strokeDasharray={beam.type === 'telegraph' ? '8,6' : undefined} strokeLinecap="round" />
                <line x1={beam.x1} y1={beam.y1} x2={beam.x2} y2={beam.y2} stroke={beam.type === 'telegraph' ? '#ffe6ff' : '#ffd1f0'} strokeWidth={beam.type === 'telegraph' ? 1.5 : 2} opacity={beam.type === 'telegraph' ? '.65' : '.85'} strokeLinecap="round" />
              </g>
            ))}
          </svg>

          {/* Enemy bullets */}
          {G.enemyBullets.map(b => (
            <div key={b.id} className="absolute w-1.5 h-1.5 rounded-full" style={{ left: b.x, top: b.y, transform: 'translate(-50%,-50%)', backgroundColor: b.color || '#f44', boxShadow: `0 0 6px ${b.color || '#f44'}` }} />
          ))}

          {/* Enemy missiles */}
          {G.enemyMissiles.map(m => (
            <div key={m.id} className="absolute w-3 h-4 rounded" style={{ left: m.x, top: m.y, transform: 'translate(-50%,-50%)', background: 'linear-gradient(to bottom, #88cc44, #ddff88)', boxShadow: '0 0 8px rgba(136,204,68,.9)' }} />
          ))}

          {/* Asteroids */}
          {G.asteroids.map(a => {
            const col = asteroidStrokeColor(a.type);
            const asteroidHpColor = hpColor(a.hp, a.maxHp);
            return (
              <div key={a.id} className="asteroid-target absolute pointer-events-auto" style={{ left: a.x, top: a.y, width: a.size * 2, height: a.size * 2, transform: `translate(-50%,-50%) rotate(${a.rotation}deg)` }}>
                <svg width={a.size * 2} height={a.size * 2} viewBox="0 0 100 100">
                  <polygon points="50,5 80,25 85,60 60,90 30,85 10,60 15,25" fill="rgba(100,100,100,.8)" stroke={col} strokeWidth={a.type === 'armored' ? 4 : 2} />
                </svg>
                <div className="absolute -bottom-2 left-1/2 h-1 rounded overflow-hidden" style={{ width: a.size * 1.5, transform: `translateX(-50%) rotate(${-a.rotation}deg)`, background: 'rgba(150,0,0,.3)', border: '1px solid rgba(255,255,255,.5)' }}>
                  <div style={{ width: `${a.hp / a.maxHp * 100}%`, height: '100%', backgroundColor: asteroidHpColor }} />
                </div>
              </div>
            );
          })}

          {/* Power-ups */}
          {G.powerUps.map(p => (
            <div key={p.id} className="absolute w-8 h-8 rounded border-2 flex items-center justify-center text-xl font-bold" style={{ left: p.x, top: p.y, transform: 'translate(-50%,-50%)', borderColor: puColor(p.type), backgroundColor: puColor(p.type) + '33', color: puColor(p.type), boxShadow: `0 0 10px ${puColor(p.type)}` }}>
              {powerUpIcon(p.type)}
            </div>
          ))}

          {/* Bullets */}
          {G.bullets.map(b => (
            <div key={b.id} className="absolute w-1.5 h-1.5 rounded-full bg-yellow-400" style={{ left: b.x, top: b.y, transform: 'translate(-50%,-50%)', boxShadow: '0 0 10px yellow' }} />
          ))}

          {/* Missiles */}
          {G.missiles.map(m => (
            <div key={m.id} className="absolute w-2 h-3 rounded-full bg-gradient-to-b from-orange-500 to-red-600" style={{ left: m.x, top: m.y, transform: 'translate(-50%,-50%)', boxShadow: '0 0 8px rgba(255,100,0,.8)' }} />
          ))}

          {/* Particles */}
          {G.particles.map(p => {
            const particleColor = p.color || `rgba(255,${Math.floor(255 * p.life)},0,${p.life})`;
            return (
              <div key={p.id} className="absolute rounded-full" style={{ left: p.x, top: p.y, width: p.size, height: p.size, transform: 'translate(-50%,-50%)', backgroundColor: particleColor, boxShadow: `0 0 ${p.size * 2}px ${particleColor}` }} />
            );
          })}

          {/* Beams */}
          {(G.beams.length > 0 || isCharging) && (
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              <defs><filter id="glow"><feGaussianBlur stdDeviation="3" result="cb"/><feMerge><feMergeNode in="cb"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
              {G.beams.map(beam => {
                const rp = hasPU('rapidfire'), sp = hasPU('spread');
                const ow = sp ? 10 + ((beam.damage-11)/33)*55 : Math.min(20, 5+beam.damage*1.5);
                const iw = sp ? 5 + ((beam.damage-11)/33)*27 : Math.min(10, 2+beam.damage*.8);
                let beamColor = 'cyan';
                if (rp) {
                  beamColor = '#ff0';
                } else if (sp) {
                  beamColor = '#f0f';
                }
                return (
                  <g key={beam.id}>
                    <line x1={ship.x} y1={ship.y} x2={beam.targetX} y2={beam.targetY} stroke={beamColor} strokeWidth={ow} opacity=".8" strokeLinecap="round" filter="url(#glow)" />
                    <line x1={ship.x} y1={ship.y} x2={beam.targetX} y2={beam.targetY} stroke="white" strokeWidth={iw} strokeLinecap="round" />
                  </g>
                );
              })}
              {isCharging && (
                <line x1={ship.x} y1={ship.y} x2={mouse.x} y2={mouse.y} stroke={chargeColor} strokeWidth="2" opacity=".5" strokeDasharray="5,5">
                  <animate attributeName="stroke-dashoffset" values="0;10" dur=".3s" repeatCount="indefinite" />
                </line>
              )}
            </svg>
          )}

          {/* Charge bar */}
          {isCharging && (
            <div className="absolute pointer-events-none" style={{ left: ship.x, top: ship.y - 42, transform: 'translateX(-50%)' }}>
              <div style={{ width: 60, height: 6, background: '#333', borderRadius: 3, border: `1px solid ${chargeColor}` }}>
                <div style={{ width: `${Math.min(100, ((Date.now() - mouseDownAt.current) / chargeDurationMs) * 100)}%`, height:'100%', borderRadius:3, backgroundColor: chargeColor }} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Crosshair */}
      <div className="relative z-[2] w-full h-full pointer-events-none">
        {gameStarted && <Crosshair color="cyan" />}
        {gameStarted && <TargetCursor targetSelector=".asteroid-target" spinDuration={0.5} />}
      </div>
    </div>
  );
}