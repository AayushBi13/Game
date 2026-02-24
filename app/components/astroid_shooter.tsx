"use client";
import React, { useState, useEffect, useRef, useCallback } from 'react';
import Crosshair from '@/app/components/crosshair';
import TargetCursor from '@/components/TargetCursor';
import PixelSnow from '@/app/components/snow';

interface Asteroid {
  id: number; x: number; y: number; size: number;
  speedX: number; speedY: number; rotation: number; rotationSpeed: number;
  hp: number; maxHp: number; type: 'normal' | 'fast' | 'armored' | 'splitting';
  stunnedUntil?: number;
}
interface Bullet { id: number; x: number; y: number; vx: number; vy: number; damage: number; remainingPierce: number; maxRange: number; traveled: number; shrapnel: boolean; railcannon?: boolean; hitShipIds?: number[]; hitAsteroidIds?: number[]; }
interface EnemyBullet { id: number; x: number; y: number; vx: number; vy: number; damage: number; color?: string; }
interface EnemyShip { id: number; x: number; y: number; hp: number; maxHp: number; shield: number; maxShield: number; vx: number; vy: number; rotation: number; lastShot: number; lastTankGrenadeAt: number; lastTankSnapAt: number; type: 'fighter' | 'sniper' | 'captain' | 'aggressive' | 'grenadier' | 'tank'; charging: boolean; chargeUntil: number; freezeLeadMs: number; aimX: number; aimY: number; shotX: number; shotY: number; stunnedUntil?: number; }
interface EnemyBeam { id: number; x1: number; y1: number; x2: number; y2: number; expiresAt: number; type: 'telegraph' | 'sniper' | 'tankGrenade' | 'tankSnap' | 'tankSnapStrike'; sourceShipId?: number; }
interface EnemyMissile { id: number; x: number; y: number; vx: number; vy: number; born: number; trackUntil: number; type?: 'homing' | 'tankGrenade' | 'tankSnap'; explodesAt?: number; stunMs?: number; blastRadius?: number; sourceShipId?: number; }
interface Particle { id: number; x: number; y: number; vx: number; vy: number; life: number; size: number; color?: string; }
interface PowerUp { id: number; x: number; y: number; type: 'shield' | 'rapidfire' | 'spread' | 'health' | 'overshield'; }
interface ActivePowerUp { type: PowerUp['type']; endTime: number; startTime: number; }
interface Beam { id: number; targetX: number; targetY: number; damage: number; hitAsteroidIds: number[]; hitShipIds: number[]; }
interface Missile { id: number; x: number; y: number; vx: number; vy: number; targetId: number; targetType: 'asteroid' | 'ship'; born: number; damage: number; ricochetCount: number; }
interface AsteroidSpec { type: Asteroid['type']; size: number; hp: number; speedMul: number; }

const DIFFICULTY_SCALER = 1;
const ENEMY_DAMAGE_MULTIPLIER = 1 + 0.25 * DIFFICULTY_SCALER;
const ENEMY_HP_MULTIPLIER = 1 + 0.05 * DIFFICULTY_SCALER;
const SNIPER_PREDICTION_FRAMES = 14;

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
  playerStunUntil: 0,
  playerShield: 0,
  playerBaseShieldMax: 100,
  playerOverShieldMax: 100,
  deathsDefied: 1,
  score: 0,
  invincible: false,
  deathDefied: false,
  deathDefiedSlowUntil: 0,
  timeSlow: false,
  timeSlowCooldown: 0,
  missileCooldown: 0,
  rapidSpinUp: 0,
  spreadSpinUp: 0,
  lastFrameAt: 0,
  nextId: 0,
  lastShot: 0,
  lastHit: 0,
  lastPlayerDamageAt: 0,
  lastShieldRegenAt: 0,
  wave: 0,
  disableEnemySpawns: false,
  waveSpawnEndsAt: 0,
  waveEndCuePlayed: true,
  waveDelayBlockedByTank: false,
  firstCaptainOverShieldDropped: false,
  lastMissileRicochetAt: 0,
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
  if (type === 'tank') return 700;
  if (type === 'captain') return 240;
  if (type === 'sniper') return 180;
  if (type === 'grenadier') return 170;
  if (type === 'aggressive') return 120;
  return 150;
}

function enemyShipDropChance(type: EnemyShip['type']) {
  if (type === 'tank') return 0.55;
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
    if (damage >= INSTA_KILL_DAMAGE_THRESHOLD) {
      return { ...ship, shield: 0 };
    }
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
    return { type: 'normal', size, hp: Math.max(1, Math.round(normalAsteroidHp(size) * ENEMY_HP_MULTIPLIER)), speedMul: 1 };
  }
  if (r < 0.8) {
    return { type: 'fast', size: 20 + Math.random() * 20, hp: Math.max(1, Math.round(2 * ENEMY_HP_MULTIPLIER)), speedMul: 2 };
  }
  if (r < 0.95) {
    return { type: 'armored', size: 60 + Math.random() * 20, hp: Math.max(1, Math.round(15 * ENEMY_HP_MULTIPLIER)), speedMul: 0.5 };
  }
  return { type: 'splitting', size: 40 + Math.random() * 20, hp: Math.max(1, Math.round(4 * ENEMY_HP_MULTIPLIER)), speedMul: 1 };
}

const TIME_SLOW_ANGLES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
const DEATH_DEFIED_SHIELD_MS = 4000;
const DEATH_DEFIED_SLOW_MS = 1400;
const TANK_GRENADE_LIFE_MS = 5000;
const TANK_GRENADE_STUN_MS = 2200;
const TANK_GRENADE_RADIUS = 125;
const TANK_SNAP_STUN_MS = 1400;
const TANK_SNAP_BEAM_DAMAGE = 16;
const TANK_SNAP_BEAM_WIDTH = 24;
const TANK_SNAP_BEAM_MS = 180;
const TANK_SNAP_LIFE_MS = 2200;
const TANK_SNAP_TRACK_MS = 260;
const RAPID_SPINUP_STEP = 0.2;
const SPREAD_SPINUP_STEP = 0.18;
const WEAPON_SPINUP_DECAY_PER_SECOND = 1.1;
const RAPID_SPINUP_RATE_MULTIPLIER_MAX = 1.7;
const RAPID_SPINUP_RATE_MULTIPLIER_MIN = 1.0;
const RAPID_SPREAD_ANGLE_MAX = 0.1;
const RAPID_SPREAD_ANGLE_MIN = 0.06;
const SPREAD_SPINUP_RATE_MULTIPLIER_MAX = 1.35;
const SPREAD_SPINUP_RATE_MULTIPLIER_MIN = 1.0;
const PLAYER_BULLET_DAMAGE = 2;
const PLAYER_BULLET_SPEED = 6;
const PLAYER_BULLET_RANGE = 1200;
const SHRAPNEL_PELLET_COUNT = 5;
const SHRAPNEL_PELLET_STEP = 0.2;
const SHRAPNEL_PELLET_DAMAGE = 1.5;
const SHRAPNEL_PELLET_SPEED = 7;
const SHRAPNEL_PELLET_RANGE = 320;
const SHRAPNEL_PELLET_PIERCE = 1;
const SHRAPNEL_KILL_POP_RADIUS = 90;
const SHRAPNEL_KILL_POP_DAMAGE = 2;
const CHARGED_RAILCANNON_MAX_CHARGE_SECONDS = 5;
const INSTA_KILL_DAMAGE_THRESHOLD = 600;
const RAILCANNON_SHOT_SPEED = 28;
const RAILCANNON_MIN_RANGE = 700;
const RAILCANNON_SHOT_RANGE = 2400;
const RAILCANNON_SHOT_PIERCE = 8;
const RAILCANNON_MIN_DAMAGE = 2;
const RAILCANNON_MAX_DAMAGE = 300;
const RAPIDFIRE_MOVE_SCALE = 0.65;
const RAPIDFIRE_SHIELD_EFFECTIVE_HP = 2;
const PLAYER_MISSILE_COUNT = 6;
const PLAYER_MISSILE_BASE_DAMAGE = 10;
const PLAYER_MISSILE_SINGLE_TARGET_DAMAGE = 6;
const SHIELDED_MISSILE_RICOCHET_CHANCE = 0.4;

export default function AsteroidShooter() {
  const [tick, setTick] = useState(0); // force re-render
  const [gameStarted, setGameStarted] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isCharging, setIsCharging] = useState(false);
  const [enemySpawnCheatOff, setEnemySpawnCheatOff] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [noTimeSlowCooldownCheat, setNoTimeSlowCooldownCheat] = useState(false);
  const [noMissileCooldownCheat, setNoMissileCooldownCheat] = useState(false);

  const rafRef = useRef(0);
  const keys = useRef(new Set<string>());
  const mouseDownAt = useRef(0);
  const mousePressed = useRef(false);
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

  const scheduleMissileLaunch = useCallback((targetId: number, delay: number, damage = PLAYER_MISSILE_BASE_DAMAGE) => {
    scheduleTimeout(() => {
      G.missiles.push({ id: id(), x: G.ship.x, y: G.ship.y, vx: 0, vy: 0, targetId, targetType: 'asteroid', born: Date.now(), damage, ricochetCount: 0 });
    }, delay);
  }, [scheduleTimeout]);

  const scheduleMissileLaunchToTarget = useCallback((targetId: number, targetType: Missile['targetType'], delay: number, damage = PLAYER_MISSILE_BASE_DAMAGE) => {
    scheduleTimeout(() => {
      G.missiles.push({ id: id(), x: G.ship.x, y: G.ship.y, vx: 0, vy: 0, targetId, targetType, born: Date.now(), damage, ricochetCount: 0 });
    }, delay);
  }, [scheduleTimeout]);

  const playWaveMusicCue = useCallback((_cueType: 'incoming' | 'start' | 'end', _waveNumber: number) => {
  }, []);

  const fireSpinUpShot = useCallback((targetX: number, targetY: number) => {
    const hasRapid = hasPU('rapidfire');
    const hasSpread = hasPU('spread');
    if (!hasRapid && !hasSpread) return;

    const now = Date.now();
    const stunnedNow = now < G.playerStunUntil;
    let rate = hasSpread ? 150 : 250;

    if (hasRapid) {
      const rapidfirePowerUp = G.activePowerUps.find(p => p.type === 'rapidfire');
      if (rapidfirePowerUp) {
        rate = Math.max(50, 100 - Math.min(1, (now - rapidfirePowerUp.startTime) / 15000) * 90);
      }
      rate *= RAPID_SPINUP_RATE_MULTIPLIER_MAX - G.rapidSpinUp * (RAPID_SPINUP_RATE_MULTIPLIER_MAX - RAPID_SPINUP_RATE_MULTIPLIER_MIN);
    } else if (hasSpread) {
      rate *= SPREAD_SPINUP_RATE_MULTIPLIER_MAX - G.spreadSpinUp * (SPREAD_SPINUP_RATE_MULTIPLIER_MAX - SPREAD_SPINUP_RATE_MULTIPLIER_MIN);
    }

    if (stunnedNow) {
      rate *= 1.5;
    }
    if (now - G.lastShot < rate) return;

    G.lastShot = now;
    if (hasRapid) {
      G.rapidSpinUp = Math.min(1, G.rapidSpinUp + RAPID_SPINUP_STEP);
    }
    if (hasSpread) {
      G.spreadSpinUp = Math.min(1, G.spreadSpinUp + SPREAD_SPINUP_STEP);
    }

    const dx = targetX - G.ship.x;
    const dy = targetY - G.ship.y;
    const baseAngle = Math.atan2(dy, dx);
    if (hasRapid) {
      const spreadAngle = RAPID_SPREAD_ANGLE_MAX - G.rapidSpinUp * (RAPID_SPREAD_ANGLE_MAX - RAPID_SPREAD_ANGLE_MIN);
      const rapidOffset = (Math.random() * 2 - 1) * spreadAngle;
      const ang = baseAngle + rapidOffset;
      G.bullets.push({
        id: id(),
        x: G.ship.x,
        y: G.ship.y,
        vx: Math.cos(ang) * PLAYER_BULLET_SPEED,
        vy: Math.sin(ang) * PLAYER_BULLET_SPEED,
        damage: PLAYER_BULLET_DAMAGE,
        remainingPierce: 0,
        maxRange: Number.POSITIVE_INFINITY,
        traveled: 0,
        shrapnel: false,
      });
      return;
    }
    if (hasSpread) {
      const half = (SHRAPNEL_PELLET_COUNT - 1) / 2;
      for (let i = 0; i < SHRAPNEL_PELLET_COUNT; i++) {
        const spreadOffset = (i - half) * SHRAPNEL_PELLET_STEP;
        const ang = baseAngle + spreadOffset;
        G.bullets.push({
          id: id(),
          x: G.ship.x,
          y: G.ship.y,
          vx: Math.cos(ang) * SHRAPNEL_PELLET_SPEED,
          vy: Math.sin(ang) * SHRAPNEL_PELLET_SPEED,
          damage: SHRAPNEL_PELLET_DAMAGE,
          remainingPierce: SHRAPNEL_PELLET_PIERCE,
          maxRange: SHRAPNEL_PELLET_RANGE,
          traveled: 0,
          shrapnel: true,
        });
      }
      return;
    }
    G.bullets.push({
      id: id(),
      x: G.ship.x,
      y: G.ship.y,
      vx: Math.cos(baseAngle) * PLAYER_BULLET_SPEED,
      vy: Math.sin(baseAngle) * PLAYER_BULLET_SPEED,
      damage: PLAYER_BULLET_DAMAGE,
      remainingPierce: 0,
      maxRange: Number.POSITIVE_INFINITY,
      traveled: 0,
      shrapnel: false,
    });
  }, []);

  const setDisableEnemySpawnCheat = useCallback((disabled: boolean) => {
    G.disableEnemySpawns = disabled;
    setEnemySpawnCheatOff(disabled);
  }, []);

  const grantDeathDefiedCheat = useCallback(() => {
    G.deathsDefied += 1;
  }, []);

  const grantPickableCheat = useCallback((type: PowerUp['type']) => {
    const now = Date.now();
    if (type === 'health') {
      G.hp = Math.min(100, G.hp + 30);
      return;
    }
    if (type === 'shield') {
      G.playerShield = Math.min(G.playerBaseShieldMax, G.playerShield + 40);
      return;
    }
    if (type === 'overshield') {
      G.playerShield = G.playerBaseShieldMax + G.playerOverShieldMax;
      return;
    }
    G.activePowerUps = G.activePowerUps.filter(a => a.type !== type && !(type === 'rapidfire' && a.type === 'spread') && !(type === 'spread' && a.type === 'rapidfire'));
    G.activePowerUps.push({ type, endTime: now + 30000, startTime: now });
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
      const rapidShieldBuffActive = hasPU('rapidfire');
      const shieldDamage = rapidShieldBuffActive ? remainingDamage / RAPIDFIRE_SHIELD_EFFECTIVE_HP : remainingDamage;
      const absorbed = Math.min(G.playerShield, shieldDamage);
      G.playerShield -= absorbed;
      remainingDamage -= rapidShieldBuffActive ? absorbed * RAPIDFIRE_SHIELD_EFFECTIVE_HP : absorbed;
      remainingDamage = Math.max(0, remainingDamage);
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
        G.deathDefiedSlowUntil = now + DEATH_DEFIED_SLOW_MS;
        scheduleTimeout(() => {
          G.invincible = false;
          G.deathDefied = false;
          G.deathDefiedSlowUntil = 0;
        }, DEATH_DEFIED_SHIELD_MS);
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
    else if (shipType === 'tank') { hp = 300; shield = 120; }

    if (shipType !== 'tank') {
      hp = Math.max(1, Math.round(hp * 1.3 * ENEMY_HP_MULTIPLIER));
    }

    G.enemyShips.push({ id: id(), x, y, hp, maxHp: hp, shield, maxShield: shield, vx: 0, vy: 0, rotation: 0, lastShot: Date.now(), lastTankGrenadeAt: Date.now(), lastTankSnapAt: Date.now(), type: shipType, charging: false, chargeUntil: 0, freezeLeadMs: 0, aimX: 0, aimY: 0, shotX: 0, shotY: 0 });
  }, []);

  const manualSpawnEnemy = useCallback((type: EnemyShip['type']) => {
    if (!G.running) return;
    spawnEnemyShip(type);
  }, [spawnEnemyShip]);

  const spawnEnemyWave = useCallback((waveNumber: number) => {
    let fighterCount: number;
    let sniperCount: number;
    let aggressiveCount: number;
    let captainCount: number;
    let grenadierCount: number;
    let tankCount: number;

    if (waveNumber % 10 === 0) {
      fighterCount = 4;
      sniperCount = 0;
      aggressiveCount = 0;
      captainCount = 0;
      grenadierCount = 2;
      tankCount = 1;
    } else if (waveNumber === 1) {
      fighterCount = 3;
      sniperCount = 1;
      aggressiveCount = 0;
      captainCount = 0;
      grenadierCount = 0;
      tankCount = 0;
    } else if (waveNumber === 2) {
      fighterCount = 4;
      sniperCount = 1;
      aggressiveCount = 0;
      captainCount = 0;
      grenadierCount = 0;
      tankCount = 0;
    } else if (waveNumber === 3) {
      fighterCount = 5;
      sniperCount = 1;
      aggressiveCount = 0;
      captainCount = 0;
      grenadierCount = 0;
      tankCount = 0;
    } else if (waveNumber === 4) {
      fighterCount = 6;
      sniperCount = 1;
      aggressiveCount = 1;
      captainCount = 0;
      grenadierCount = 1;
      tankCount = 0;
    } else if (waveNumber === 5) {
      fighterCount = 6;
      sniperCount = 2;
      aggressiveCount = 1;
      captainCount = 1;
      grenadierCount = 1;
      tankCount = 0;
    } else if (waveNumber === 6) {
      fighterCount = 6;
      sniperCount = 2;
      aggressiveCount = 2;
      captainCount = 1;
      grenadierCount = 1;
      tankCount = 0;
    } else {
      const rampLevel = 1 + Math.floor((waveNumber - 7) / 3.5);
      fighterCount = 6;
      sniperCount = Math.min(3, 2 + Math.floor(rampLevel / 1.2));
      aggressiveCount = Math.min(2, 1 + Math.floor(rampLevel / 2));
      captainCount = Math.min(2, 1 + Math.floor(rampLevel / 2));
      grenadierCount = Math.min(2, 1 + Math.floor(rampLevel / 2.5));
      tankCount = 0;
    }

    const waveShips: EnemyShip['type'][] = [];
    for (let i = 0; i < fighterCount; i++) waveShips.push('fighter');
    for (let i = 0; i < sniperCount; i++) waveShips.push('sniper');
    for (let i = 0; i < aggressiveCount; i++) waveShips.push('aggressive');
    for (let i = 0; i < captainCount; i++) waveShips.push('captain');
    for (let i = 0; i < grenadierCount; i++) waveShips.push('grenadier');
    for (let i = 0; i < tankCount; i++) waveShips.push('tank');

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
        if (G.disableEnemySpawns) return;
        spawnEnemyShip(shipType);
      }, index * spawnGap);
    });
  }, [scheduleTimeout, spawnEnemyShip]);

  // ── main game loop ──
  const loop = useCallback(() => {
    if (!G.running) return;
    const now = Date.now();
    const dtSeconds = G.lastFrameAt > 0 ? Math.min(0.1, (now - G.lastFrameAt) / 1000) : 1 / 60;
    G.lastFrameAt = now;
    const deathDefiedSlowActive = now < G.deathDefiedSlowUntil;
    const slow = G.timeSlow || deathDefiedSlowActive ? 0.3 : 1;
    const enemyTimeScale = 1 / slow;
    const W = window.innerWidth, H = window.innerHeight;
    const ship = G.ship;
    const playerStunned = now < G.playerStunUntil;

    const hasRapidNow = hasPU('rapidfire');
    const hasSpreadNow = hasPU('spread');
    const spinUpHolding = mousePressed.current && (hasRapidNow || hasSpreadNow);
    if (playerStunned) {
      G.rapidSpinUp = 0;
      G.spreadSpinUp = 0;
    } else if (!spinUpHolding) {
      const decay = WEAPON_SPINUP_DECAY_PER_SECOND * dtSeconds;
      if (!hasRapidNow || G.rapidSpinUp > 0) {
        G.rapidSpinUp = Math.max(0, G.rapidSpinUp - decay);
      }
      if (!hasSpreadNow || G.spreadSpinUp > 0) {
        G.spreadSpinUp = Math.max(0, G.spreadSpinUp - decay);
      }
      if (!hasRapidNow) G.rapidSpinUp = 0;
      if (!hasSpreadNow) G.spreadSpinUp = 0;
    }

    if (spinUpHolding) {
      fireSpinUpShot(G.mouse.x, G.mouse.y);
    }

    // Ship movement
    const chargingNormalShot = mousePressed.current && mouseDownAt.current > 0 && !hasRapidNow && !hasSpreadNow;
    const chargeHoldSeconds = chargingNormalShot ? Math.max(0, (now - mouseDownAt.current) / 1000) : 0;
    const chargeRatioNow = Math.min(1, chargeHoldSeconds / CHARGED_RAILCANNON_MAX_CHARGE_SECONDS);
    const chargeMoveScale = 1 - chargeRatioNow * 0.6;
    const spreadMoveBuffScale = hasSpreadNow ? 1.25 : 1;
    const rapidMoveScale = hasRapidNow ? RAPIDFIRE_MOVE_SCALE : 1;
    const totalMoveScale = spreadMoveBuffScale * rapidMoveScale;
    const accel = 0.3 * chargeMoveScale, maxS = 3 * chargeMoveScale, fric = 0.92;
    if (!playerStunned) {
      if (keys.current.has('w') || keys.current.has('arrowup')) G.vel.y -= accel;
      if (keys.current.has('s') || keys.current.has('arrowdown')) G.vel.y += accel;
      if (keys.current.has('a') || keys.current.has('arrowleft')) G.vel.x -= accel;
      if (keys.current.has('d') || keys.current.has('arrowright')) G.vel.x += accel;
      G.vel.x *= fric; G.vel.y *= fric;
      const spd = Math.hypot(G.vel.x, G.vel.y);
      if (spd > maxS) { G.vel.x = G.vel.x / spd * maxS; G.vel.y = G.vel.y / spd * maxS; }
      ship.x = Math.max(30, Math.min(W - 30, ship.x + G.vel.x * totalMoveScale));
      ship.y = Math.max(30, Math.min(H - 30, ship.y + G.vel.y * totalMoveScale));
    } else {
      G.vel.x = 0;
      G.vel.y = 0;
    }

    // Player shield recharge (base shield only)
    if (now - G.lastPlayerDamageAt >= 2000 && G.playerShield < G.playerBaseShieldMax) {
      const elapsedSeconds = (now - G.lastShieldRegenAt) / 1000;
      if (elapsedSeconds > 0) {
        G.playerShield = Math.min(G.playerBaseShieldMax, G.playerShield + elapsedSeconds * 5);
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
      x: a.x + (now < (a.stunnedUntil ?? 0) ? 0 : a.speedX * slow),
      y: a.y + (now < (a.stunnedUntil ?? 0) ? 0 : a.speedY * slow),
      rotation: a.rotation + a.rotationSpeed,
    })).filter(a => {
      if (a.x < -150 || a.x > W + 150 || a.y < -150 || a.y > H + 150) return false;
      // Ship collision
      if (!G.invincible && dist(a.x, a.y, ship.x, ship.y) < a.size + 20) {
        if (now - G.lastHit > 2000) {
          G.lastHit = now;
          takeDamage(Math.max(1, Math.round(20 * ENEMY_DAMAGE_MULTIPLIER)));
          spawnParticles(a.x, a.y, 12);
          if (!G.invincible) { G.invincible = true; scheduleTimeout(() => { G.invincible = false; }, 2000); }
        }
        return false;
      }
      return true;
    });

    // Bullets
    G.bullets = G.bullets.map(b => {
      const nextX = b.x + b.vx;
      const nextY = b.y + b.vy;
      return {
        ...b,
        x: nextX,
        y: nextY,
        traveled: b.traveled + Math.hypot(b.vx, b.vy),
      };
    }).filter(b => b.x > 0 && b.x < W && b.y > 0 && b.y < H && b.traveled <= b.maxRange);

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
      const shipStunned = now < (s.stunnedUntil ?? 0);
      const isSniper = s.type === 'sniper';
      const isCaptain = s.type === 'captain';
      const isAggressive = s.type === 'aggressive';
      const isGrenadier = s.type === 'grenadier';
      const isTank = s.type === 'tank';
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
      } else if (isTank) {
        target = 420;
        maxSpd = 0.42;
        accelToward = 0.04;
        accelAway = 0.04;
      }
      let vx = s.vx, vy = s.vy;
      if (shipStunned) {
        vx = 0;
        vy = 0;
      } else if (d > 0) {
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
      if (shipStunned) {
        return { ...s, x: s.x, y: s.y, vx: 0, vy: 0, rotation: Math.atan2(dy, dx) * 180 / Math.PI + 90 };
      }

      if (isSniper) {
        const chargeRemaining = s.chargeUntil - now;
        if (s.charging && chargeRemaining > 0 && chargeRemaining <= s.freezeLeadMs) {
          vx = 0;
          vy = 0;
        }
        if (s.charging && now < s.chargeUntil) {
          const telegraphIndex = G.enemyBeams.findIndex(beam => beam.type === 'telegraph' && beam.sourceShipId === s.id);
          if (telegraphIndex >= 0) {
            G.enemyBeams[telegraphIndex] = {
              ...G.enemyBeams[telegraphIndex],
              x1: s.x,
              y1: s.y,
              x2: ship.x,
              y2: ship.y,
            };
          }
        }
        if (s.charging && now >= s.chargeUntil) {
          const shotX = s.x;
          const shotY = s.y;
          const aimX = Math.max(0, Math.min(W, ship.x + G.vel.x * SNIPER_PREDICTION_FRAMES));
          const aimY = Math.max(0, Math.min(H, ship.y + G.vel.y * SNIPER_PREDICTION_FRAMES));
          G.enemyBeams.push({ id: id(), x1: shotX, y1: shotY, x2: aimX, y2: aimY, expiresAt: now + 180, type: 'sniper' });

          for (let ai = G.asteroids.length - 1; ai >= 0; ai--) {
            const a = G.asteroids[ai];
            if (pointToSegmentDistance(a.x, a.y, shotX, shotY, aimX, aimY) < a.size + 4) {
              G.asteroids[ai] = { ...a, hp: a.hp - 14 };
              spawnParticles(a.x, a.y, 8, '#ff88dd');
              if (G.asteroids[ai].hp <= 0) {
                spawnParticles(a.x, a.y, 12, asteroidColor(a.type));
                G.asteroids.splice(ai, 1);
              }
            }
          }

          if (pointToSegmentDistance(ship.x, ship.y, shotX, shotY, aimX, aimY) < 26) {
            takeDamage(Math.max(1, Math.round(30 * ENEMY_DAMAGE_MULTIPLIER)));
            spawnParticles(ship.x, ship.y, 10, '#ff1177');
          }
          s = { ...s, lastShot: now, charging: false, freezeLeadMs: 0 };
        } else if (!s.charging && now - s.lastShot > 1700 * enemyTimeScale && d > 450) {
          const chargeDuration = 1200 * enemyTimeScale;
          const freezeLeadMs = 250 * enemyTimeScale;
          G.enemyBeams.push({ id: id(), x1: s.x, y1: s.y, x2: ship.x, y2: ship.y, expiresAt: now + chargeDuration, type: 'telegraph', sourceShipId: s.id });
          s = { ...s, charging: true, chargeUntil: now + chargeDuration, freezeLeadMs, aimX: ship.x, aimY: ship.y, shotX: s.x, shotY: s.y };
        }
      } else if (isCaptain && now - s.lastShot > 280 * enemyTimeScale && d < 560) {
        const a = Math.atan2(dy, dx);
        G.enemyBullets.push({ id: id(), x: s.x, y: s.y, vx: Math.cos(a) * 5.4, vy: Math.sin(a) * 5.4, damage: 4, color: '#7dd3fc' });
        s = { ...s, lastShot: now };
      } else if (isAggressive && now - s.lastShot > 850 * enemyTimeScale && d < 340) {
        const baseA = Math.atan2(dy, dx);
        const spread = 0.22;
        for (let i = -2; i <= 2; i++) {
          const a = baseA + i * spread;
          G.enemyBullets.push({ id: id(), x: s.x, y: s.y, vx: Math.cos(a) * 4.5, vy: Math.sin(a) * 4.5, damage: 2, color: '#ff9933' });
        }
        s = { ...s, lastShot: now };
      } else if (isGrenadier && now - s.lastShot > (5000 + Math.random() * 1000) * enemyTimeScale && d < 550) {
        const a = Math.atan2(dy, dx);
        const speed = 2.8;
        const trackDuration = (2000 + Math.random() * 1000) * enemyTimeScale;
        G.enemyMissiles.push({ id: id(), x: s.x, y: s.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, born: now, trackUntil: now + trackDuration });
        s = { ...s, lastShot: now };
      } else if (isTank && now - s.lastShot > 120 * enemyTimeScale && d < 700) {
        const predictedX = ship.x + G.vel.x * 1.8;
        const predictedY = ship.y + G.vel.y * 1.8;
        const baseA = Math.atan2(predictedY - s.y, predictedX - s.x);
        const a = baseA + (Math.random() - 0.5) * 0.476;
        const bulletSpeed = 4.2;
        G.enemyBullets.push({ id: id(), x: s.x, y: s.y, vx: Math.cos(a) * bulletSpeed, vy: Math.sin(a) * bulletSpeed, damage: 5, color: '#a78bfa' });
        s = { ...s, lastShot: now };
      } else if (!isSniper && !isCaptain && !isAggressive && !isGrenadier && !isTank && now - s.lastShot > 500 * enemyTimeScale && d < 500) {
        const a = Math.atan2(dy, dx);
        G.enemyBullets.push({ id: id(), x: s.x, y: s.y, vx: Math.cos(a) * 4, vy: Math.sin(a) * 4, damage: 3, color: '#ff4444' });
        s = { ...s, lastShot: now };
      }

      if (isTank && now - s.lastTankGrenadeAt > 9000 * enemyTimeScale && d < 850) {
        const telegraphMs = 900;
        G.enemyBeams.push({ id: id(), x1: s.x, y1: s.y, x2: ship.x, y2: ship.y, expiresAt: now + telegraphMs, type: 'tankGrenade', sourceShipId: s.id });
        const tankId = s.id;
        scheduleTimeout(() => {
          const src = G.enemyShips.find(es => es.id === tankId);
          if (!src || !G.running) return;
          const a = Math.atan2(G.ship.y - src.y, G.ship.x - src.x);
          const grenadeSpeed = 1.6;
          G.enemyMissiles.push({
            id: id(),
            x: src.x,
            y: src.y,
            vx: Math.cos(a) * grenadeSpeed,
            vy: Math.sin(a) * grenadeSpeed,
            born: Date.now(),
            trackUntil: Date.now() + TANK_GRENADE_LIFE_MS,
            type: 'tankGrenade',
            explodesAt: Date.now() + TANK_GRENADE_LIFE_MS,
            stunMs: TANK_GRENADE_STUN_MS,
            blastRadius: TANK_GRENADE_RADIUS,
            sourceShipId: tankId,
          });
        }, telegraphMs);
        s = { ...s, lastTankGrenadeAt: now };
      }

      if (isTank && now - s.lastTankSnapAt > 6500 * enemyTimeScale && d < 760) {
        const telegraphMs = 820;
        G.enemyBeams.push({ id: id(), x1: s.x, y1: s.y, x2: ship.x, y2: ship.y, expiresAt: now + telegraphMs, type: 'tankSnap', sourceShipId: s.id });
        const tankId = s.id;
        scheduleTimeout(() => {
          const src = G.enemyShips.find(es => es.id === tankId);
          if (!src || !G.running) return;
          const snapNow = Date.now();
          const aimX = Math.max(0, Math.min(W, G.ship.x + G.vel.x * 10));
          const aimY = Math.max(0, Math.min(H, G.ship.y + G.vel.y * 10));

          G.enemyBeams.push({
            id: id(),
            x1: src.x,
            y1: src.y,
            x2: aimX,
            y2: aimY,
            expiresAt: snapNow + TANK_SNAP_BEAM_MS,
            type: 'tankSnapStrike',
            sourceShipId: src.id,
          });

          if (pointToSegmentDistance(G.ship.x, G.ship.y, src.x, src.y, aimX, aimY) < TANK_SNAP_BEAM_WIDTH) {
            G.playerStunUntil = Math.max(G.playerStunUntil, snapNow + TANK_SNAP_STUN_MS);
            takeDamage(Math.max(1, Math.round(TANK_SNAP_BEAM_DAMAGE * ENEMY_DAMAGE_MULTIPLIER)));
            spawnParticles(G.ship.x, G.ship.y, 12, '#d8b4fe');
          }

          for (let ai = G.asteroids.length - 1; ai >= 0; ai--) {
            const a = G.asteroids[ai];
            if (pointToSegmentDistance(a.x, a.y, src.x, src.y, aimX, aimY) < a.size + 6) {
              damageAsteroidFromEnemyWeapon(ai, TANK_SNAP_BEAM_DAMAGE, '#c4b5fd');
            }
          }
        }, telegraphMs);
        s = { ...s, lastTankSnapAt: now };
      }

      return { ...s, x: s.x + vx * slow, y: s.y + vy * slow, vx, vy, rotation: Math.atan2(dy, dx) * 180 / Math.PI + 90 };
    }).filter(s => s.x > -200 && s.x < W + 200 && s.y > -200 && s.y < H + 200);

    // Enemy beams (visual lifetime)
    G.enemyBeams = G.enemyBeams.filter(beam => now < beam.expiresAt);

    if (!G.waveEndCuePlayed && G.wave > 0 && now >= G.waveSpawnEndsAt && G.enemyShips.length === 0) {
      playWaveMusicCue('end', G.wave);
      G.waveEndCuePlayed = true;
    }

    const damageAsteroidFromEnemyWeapon = (asteroidIndex: number, damage: number, particleColor?: string) => {
      const asteroid = G.asteroids[asteroidIndex];
      if (!asteroid) return;
      G.asteroids[asteroidIndex] = { ...asteroid, hp: asteroid.hp - damage };
      if (particleColor) {
        spawnParticles(asteroid.x, asteroid.y, 5, particleColor);
      }
      if (G.asteroids[asteroidIndex].hp <= 0) {
        spawnParticles(asteroid.x, asteroid.y, 12, asteroidColor(asteroid.type));
        if (asteroid.type === 'splitting') {
          for (let k = 0; k < 3; k++) {
            const ang = (Math.PI * 2 * k) / 3 + Math.random() * 0.5;
            const s = 1 + Math.random() * 1.5;
            G.asteroids.push({ id: id(), x: asteroid.x, y: asteroid.y, size: 20, speedX: Math.cos(ang) * s, speedY: Math.sin(ang) * s, rotation: Math.random() * 360, rotationSpeed: (Math.random() - 0.5) * 3, hp: 1, maxHp: 1, type: 'fast' });
          }
        }
        G.asteroids.splice(asteroidIndex, 1);
      }
    };

    // Enemy bullets
    G.enemyBullets = G.enemyBullets
      .map(b => ({ ...b, x: b.x + b.vx * slow, y: b.y + b.vy * slow }))
      .filter(b => {
        if (b.x < 0 || b.x > W || b.y < 0 || b.y > H) return false;

        for (let ai = G.asteroids.length - 1; ai >= 0; ai--) {
          const a = G.asteroids[ai];
          if (dist(b.x, b.y, a.x, a.y) < a.size) {
            damageAsteroidFromEnemyWeapon(ai, Math.max(1, Math.round(b.damage * 1.2)), '#ff8866');
            return false;
          }
        }

        if (!G.invincible && dist(b.x, b.y, ship.x, ship.y) < 20) {
          takeDamage(Math.max(1, Math.round(b.damage * ENEMY_DAMAGE_MULTIPLIER)));
          spawnParticles(ship.x, ship.y, 6, '#ff4444');
          return false;
        }
        return true;
      });

    // Enemy missiles (homing)
    G.enemyMissiles = G.enemyMissiles.map(m => {
      if (m.type === 'tankGrenade' && now >= (m.explodesAt ?? m.trackUntil)) {
        const blastRadius = m.blastRadius ?? TANK_GRENADE_RADIUS;
        const stunMs = m.stunMs ?? TANK_GRENADE_STUN_MS;
        spawnParticles(m.x, m.y, 18, '#f5d76e');
        G.enemyBeams.push({ id: id(), x1: m.x - blastRadius, y1: m.y, x2: m.x + blastRadius, y2: m.y, expiresAt: now + 240, type: 'tankGrenade' });
        G.enemyBeams.push({ id: id(), x1: m.x, y1: m.y - blastRadius, x2: m.x, y2: m.y + blastRadius, expiresAt: now + 240, type: 'tankGrenade' });
        if (dist(m.x, m.y, ship.x, ship.y) <= blastRadius) {
          G.playerStunUntil = Math.max(G.playerStunUntil, now + stunMs);
        }
        G.asteroids = G.asteroids.map(a => (dist(m.x, m.y, a.x, a.y) <= blastRadius + a.size
          ? { ...a, stunnedUntil: Math.max(a.stunnedUntil ?? 0, now + stunMs) }
          : a));
        G.enemyShips = G.enemyShips.map(es => (dist(m.x, m.y, es.x, es.y) <= blastRadius + 18
          ? { ...es, stunnedUntil: Math.max(es.stunnedUntil ?? 0, now + stunMs) }
          : es));
        if (m.sourceShipId !== undefined) {
          G.enemyShips = G.enemyShips.map(es => (
            es.id === m.sourceShipId
              ? { ...es, stunnedUntil: Math.max(es.stunnedUntil ?? 0, now + stunMs) }
              : es
          ));
        }
        return { ...m, x: -9999, y: -9999 };
      }

      let newVx = m.vx;
      let newVy = m.vy;
      if (m.type === 'tankSnap' && now < m.trackUntil) {
        const dxToPlayer = ship.x - m.x;
        const dyToPlayer = ship.y - m.y;
        const targetAngle = Math.atan2(dyToPlayer, dxToPlayer);
        const currentAngle = Math.atan2(m.vy, m.vx);
        let angleDiff = targetAngle - currentAngle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        const newAngle = currentAngle + angleDiff * 0.09;
        const speed = Math.max(4.7, Math.hypot(m.vx, m.vy));
        newVx = Math.cos(newAngle) * speed;
        newVy = Math.sin(newAngle) * speed;
      } else if (now < m.trackUntil) {
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
        x: m.x + newVx * slow,
        y: m.y + newVy * slow,
        vx: newVx,
        vy: newVy,
      };
    }).filter(m => {
      if (m.x < -100 || m.x > W + 100 || m.y < -100 || m.y > H + 100) return false;
      if (m.type === 'tankSnap' && now - m.born > TANK_SNAP_LIFE_MS) return false;

      for (let ai = G.asteroids.length - 1; ai >= 0; ai--) {
        const a = G.asteroids[ai];
        if (dist(m.x, m.y, a.x, a.y) < a.size + 6) {
          if (m.type === 'tankSnap') {
            G.asteroids[ai] = { ...a, stunnedUntil: Math.max(a.stunnedUntil ?? 0, now + (m.stunMs ?? TANK_SNAP_STUN_MS)) };
            spawnParticles(a.x, a.y, 8, '#c4b5fd');
            return false;
          }
          if (m.type !== 'tankGrenade') {
            damageAsteroidFromEnemyWeapon(ai, 10, '#ffaa66');
            return false;
          }
        }
      }

      if (m.type === 'tankGrenade') {
        return true;
      }
      if (dist(m.x, m.y, ship.x, ship.y) < 22) {
        if (m.type === 'tankSnap') {
          G.playerStunUntil = Math.max(G.playerStunUntil, now + (m.stunMs ?? TANK_SNAP_STUN_MS));
          spawnParticles(ship.x, ship.y, 10, '#d8b4fe');
          return false;
        }
        if (!G.invincible) {
          takeDamage(Math.max(1, Math.round(20 * ENEMY_DAMAGE_MULTIPLIER)));
          spawnParticles(ship.x, ship.y, 10, '#ff8800');
          return false;
        }
      }
      return true;
    });

    // ── BULLET vs ENEMY SHIPS ──
    // Both arrays are plain JS arrays in G — no React state involved
    const usedBullets = new Set<number>();
    for (let si = G.enemyShips.length - 1; si >= 0; si--) {
      for (let bi = G.bullets.length - 1; bi >= 0; bi--) {
        const b = G.bullets[bi];
        if (usedBullets.has(b.id)) continue;
        const ship2 = G.enemyShips[si];
        if (!ship2) continue;
        if ((b.hitShipIds ?? []).includes(ship2.id)) continue;
        if (dist(b.x, b.y, ship2.x, ship2.y) < 30) {
          G.enemyShips[si] = damageEnemyShip(ship2, b.damage);
          if (ship2.shield > 0) {
            spawnParticles(ship2.x, ship2.y, 4, '#66ccff');
          }
          const hitShipIds = [...(b.hitShipIds ?? []), ship2.id];
          if (b.remainingPierce > 0) {
            G.bullets[bi] = { ...b, remainingPierce: b.remainingPierce - 1, hitShipIds };
          } else {
            usedBullets.add(b.id);
          }
          if (G.enemyShips[si] && G.enemyShips[si].hp <= 0) {
            spawnParticles(ship2.x, ship2.y, 15, '#ff6600');
            G.score += enemyShipReward(ship2.type);
            if (Math.random() < enemyShipDropChance(ship2.type)) spawnPowerUp(ship2.x, ship2.y);
            if (shouldDropOverShield(ship2.type)) spawnOverShieldPowerUp(ship2.x, ship2.y);
            G.enemyShips.splice(si, 1);
            if (b.shrapnel) {
              spawnParticles(ship2.x, ship2.y, 12, '#a7f3d0');
              for (let sj = G.enemyShips.length - 1; sj >= 0; sj--) {
                const nearShip = G.enemyShips[sj];
                if (dist(nearShip.x, nearShip.y, ship2.x, ship2.y) <= SHRAPNEL_KILL_POP_RADIUS) {
                  G.enemyShips[sj] = damageEnemyShip(nearShip, SHRAPNEL_KILL_POP_DAMAGE);
                  if (G.enemyShips[sj].hp <= 0) {
                    spawnParticles(nearShip.x, nearShip.y, 10, '#34d399');
                    G.score += enemyShipReward(nearShip.type);
                    if (Math.random() < enemyShipDropChance(nearShip.type)) spawnPowerUp(nearShip.x, nearShip.y);
                    if (shouldDropOverShield(nearShip.type)) spawnOverShieldPowerUp(nearShip.x, nearShip.y);
                    G.enemyShips.splice(sj, 1);
                  }
                }
              }
              for (let aj = G.asteroids.length - 1; aj >= 0; aj--) {
                const nearAsteroid = G.asteroids[aj];
                if (dist(nearAsteroid.x, nearAsteroid.y, ship2.x, ship2.y) <= SHRAPNEL_KILL_POP_RADIUS + nearAsteroid.size) {
                  G.asteroids[aj] = { ...nearAsteroid, hp: nearAsteroid.hp - SHRAPNEL_KILL_POP_DAMAGE };
                  if (G.asteroids[aj].hp <= 0) {
                    spawnParticles(nearAsteroid.x, nearAsteroid.y, 10, asteroidColor(nearAsteroid.type));
                    G.score += Math.floor(nearAsteroid.size * (nearAsteroid.type === 'armored' ? 2 : 1));
                    G.asteroids.splice(aj, 1);
                  }
                }
              }
            }
          }
          break;
        }
      }
    }
    G.bullets = G.bullets.filter(b => !usedBullets.has(b.id));

    // ── BULLET vs ASTEROIDS ──
    const usedBullets2 = new Set<number>();
    for (let ai = G.asteroids.length - 1; ai >= 0; ai--) {
      for (let bi = G.bullets.length - 1; bi >= 0; bi--) {
        const b = G.bullets[bi];
        if (usedBullets2.has(b.id)) continue;
        const a = G.asteroids[ai];
        if (!a) continue;
        if ((b.hitAsteroidIds ?? []).includes(a.id)) continue;
        if (dist(b.x, b.y, a.x, a.y) < a.size) {
          G.asteroids[ai] = { ...a, hp: a.hp - b.damage };
          const hitAsteroidIds = [...(b.hitAsteroidIds ?? []), a.id];
          if (b.remainingPierce > 0) {
            G.bullets[bi] = { ...b, remainingPierce: b.remainingPierce - 1, hitAsteroidIds };
          } else {
            usedBullets2.add(b.id);
          }
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
            if (b.shrapnel) {
              spawnParticles(a.x, a.y, 10, '#a7f3d0');
              for (let aj = G.asteroids.length - 1; aj >= 0; aj--) {
                const nearAsteroid = G.asteroids[aj];
                if (dist(nearAsteroid.x, nearAsteroid.y, a.x, a.y) <= SHRAPNEL_KILL_POP_RADIUS + nearAsteroid.size) {
                  G.asteroids[aj] = { ...nearAsteroid, hp: nearAsteroid.hp - SHRAPNEL_KILL_POP_DAMAGE };
                  if (G.asteroids[aj].hp <= 0) {
                    spawnParticles(nearAsteroid.x, nearAsteroid.y, 10, asteroidColor(nearAsteroid.type));
                    G.score += Math.floor(nearAsteroid.size * (nearAsteroid.type === 'armored' ? 2 : 1));
                    G.asteroids.splice(aj, 1);
                  }
                }
              }
              for (let sj = G.enemyShips.length - 1; sj >= 0; sj--) {
                const nearShip = G.enemyShips[sj];
                if (dist(nearShip.x, nearShip.y, a.x, a.y) <= SHRAPNEL_KILL_POP_RADIUS + 20) {
                  G.enemyShips[sj] = damageEnemyShip(nearShip, SHRAPNEL_KILL_POP_DAMAGE);
                  if (G.enemyShips[sj].hp <= 0) {
                    spawnParticles(nearShip.x, nearShip.y, 10, '#34d399');
                    G.score += enemyShipReward(nearShip.type);
                    if (Math.random() < enemyShipDropChance(nearShip.type)) spawnPowerUp(nearShip.x, nearShip.y);
                    if (shouldDropOverShield(nearShip.type)) spawnOverShieldPowerUp(nearShip.x, nearShip.y);
                    G.enemyShips.splice(sj, 1);
                  }
                }
              }
            }
          } else {
            spawnParticles(a.x, a.y, b.shrapnel ? 4 : 3, b.shrapnel ? '#86efac' : undefined);
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
          G.asteroids[ai] = { ...a, hp: a.hp - m.damage };
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
    const processedMissilesOnShips = new Set<number>();
    for (let si = G.enemyShips.length - 1; si >= 0; si--) {
      const enemyShip = G.enemyShips[si];
      for (let mi = G.missiles.length - 1; mi >= 0; mi--) {
        const missile = G.missiles[mi];
        if (usedMissilesOnShips.has(missile.id)) continue;
        if (processedMissilesOnShips.has(missile.id)) continue;
        if (dist(missile.x, missile.y, enemyShip.x, enemyShip.y) < 26) {
          processedMissilesOnShips.add(missile.id);
          spawnParticles(missile.x, missile.y, 10, '#ffaa00');
          G.enemyShips[si] = damageEnemyShip(enemyShip, missile.damage);
          if (enemyShip.shield > 0) {
            spawnParticles(enemyShip.x, enemyShip.y, 6, '#66ccff');
            if (Math.random() < SHIELDED_MISSILE_RICOCHET_CHANCE) {
              const shipTargets = G.enemyShips
                .filter(s => s.id !== enemyShip.id)
                .map(s => ({ id: s.id, type: 'ship' as const }));
              const asteroidTargets = G.asteroids.map(a => ({ id: a.id, type: 'asteroid' as const }));
              const ricochetTargets = [...shipTargets, ...asteroidTargets];
              if (ricochetTargets.length > 0) {
                G.lastMissileRicochetAt = now;
                spawnParticles(enemyShip.x, enemyShip.y, 14, '#7dd3fc');
                const nextTarget = ricochetTargets[Math.floor(Math.random() * ricochetTargets.length)];
                const bounceAngle = Math.atan2(missile.y - enemyShip.y, missile.x - enemyShip.x);
                const bounceSpeed = Math.max(2.5, Math.hypot(missile.vx, missile.vy));
                G.missiles[mi] = {
                  ...missile,
                  targetId: nextTarget.id,
                  targetType: nextTarget.type,
                  x: enemyShip.x + Math.cos(bounceAngle) * 8,
                  y: enemyShip.y + Math.sin(bounceAngle) * 8,
                  vx: Math.cos(bounceAngle) * bounceSpeed,
                  vy: Math.sin(bounceAngle) * bounceSpeed,
                  damage: Math.max(1, missile.damage * 0.85),
                  ricochetCount: missile.ricochetCount + 1,
                };
                break;
              }
            }
          }
          usedMissilesOnShips.add(missile.id);
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
      if (!beam.hitAsteroidIds) beam.hitAsteroidIds = [];
      if (!beam.hitShipIds) beam.hitShipIds = [];
      const dx = beam.targetX - ship.x, dy = beam.targetY - ship.y;
      const blen = Math.hypot(dx, dy);
      if (blen === 0) continue;
      const bw = hasPU('spread') ? 10 + ((beam.damage - 11) / 33) * 55 : 10;
      for (let ai = G.asteroids.length - 1; ai >= 0; ai--) {
        const a = G.asteroids[ai];
        if (beam.hitAsteroidIds.includes(a.id)) continue;
        const ax = a.x - ship.x, ay = a.y - ship.y;
        const proj = (ax * dx + ay * dy) / (blen ** 2);
        if (proj < 0 || proj > 1) continue;
        const cx = ship.x + proj * dx, cy = ship.y + proj * dy;
        if (dist(a.x, a.y, cx, cy) < a.size + bw) {
          beam.hitAsteroidIds.push(a.id);
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
        if (beam.hitShipIds.includes(enemyShip.id)) continue;
        const ex = enemyShip.x - ship.x;
        const ey = enemyShip.y - ship.y;
        const proj = (ex * dx + ey * dy) / (blen ** 2);
        if (proj < 0 || proj > 1) continue;
        const cx = ship.x + proj * dx;
        const cy = ship.y + proj * dy;
        const shipRadius = 20;
        if (dist(enemyShip.x, enemyShip.y, cx, cy) < shipRadius + bw) {
          beam.hitShipIds.push(enemyShip.id);
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
  }, [takeDamage, spawnAsteroid, spawnEnemyShip, scheduleTimeout, playWaveMusicCue, fireSpinUpShot]);

  // Input
  useEffect(() => {
    const onMove = (e: MouseEvent) => { G.mouse.x = e.clientX; G.mouse.y = e.clientY; };
    const stopPress = () => {
      mousePressed.current = false;
      mouseDownAt.current = 0;
      setIsCharging(false);
    };
    const onDown = (e: MouseEvent) => {
      if (!G.running) return;
      mousePressed.current = true;
      if (hasPU('rapidfire') || hasPU('spread')) {
        mouseDownAt.current = 0;
        setIsCharging(false);
        fireSpinUpShot(e.clientX, e.clientY);
        return;
      }
      mouseDownAt.current = Date.now();
      setIsCharging(true);
    };
    const onUp = (e: MouseEvent) => {
      if (!G.running) return;
      mousePressed.current = false;
      const hasRapid = hasPU('rapidfire');
      const hasSpread = hasPU('spread');
      const useSpinUpFiring = hasRapid || hasSpread;
      if (useSpinUpFiring) {
        setIsCharging(false);
        mouseDownAt.current = 0;
        return;
      }
      if (mouseDownAt.current <= 0) return;
      const hold = (Date.now() - mouseDownAt.current) / 1000;
      const stunnedOnRelease = Date.now() < G.playerStunUntil;
      const effectiveHold = stunnedOnRelease ? hold / 1.3 : hold;
      setIsCharging(false);
      mouseDownAt.current = 0;
      if (hold < 0.1) {
        // Quick shot
        const now = Date.now();
        let rate = 250;
        if (stunnedOnRelease) {
          rate *= 1.5;
        }
        if (now - G.lastShot < rate) return;
        G.lastShot = now;
        const dx = e.clientX - G.ship.x, dy = e.clientY - G.ship.y;
        const ang = Math.atan2(dy, dx);
        G.bullets.push({
          id: id(),
          x: G.ship.x,
          y: G.ship.y,
          vx: Math.cos(ang) * PLAYER_BULLET_SPEED,
          vy: Math.sin(ang) * PLAYER_BULLET_SPEED,
          damage: PLAYER_BULLET_DAMAGE,
          remainingPierce: 0,
          maxRange: Number.POSITIVE_INFINITY,
          traveled: 0,
          shrapnel: false,
        });
      } else {
        const chargeRatio = Math.min(1, effectiveHold / CHARGED_RAILCANNON_MAX_CHARGE_SECONDS);
        const railcannonDamage = Math.round(
          RAILCANNON_MIN_DAMAGE +
          (chargeRatio ** 2) * (RAILCANNON_MAX_DAMAGE - RAILCANNON_MIN_DAMAGE)
        );
        const railcannonPierce = Math.max(0, Math.round(chargeRatio * RAILCANNON_SHOT_PIERCE));
        const railcannonRange = RAILCANNON_MIN_RANGE + chargeRatio * (RAILCANNON_SHOT_RANGE - RAILCANNON_MIN_RANGE);
        const dx = e.clientX - G.ship.x;
        const dy = e.clientY - G.ship.y;
        const ang = Math.atan2(dy, dx);
        G.bullets.push({
          id: id(),
          x: G.ship.x,
          y: G.ship.y,
          vx: Math.cos(ang) * RAILCANNON_SHOT_SPEED,
          vy: Math.sin(ang) * RAILCANNON_SHOT_SPEED,
          damage: railcannonDamage,
          remainingPierce: railcannonPierce,
          maxRange: railcannonRange,
          traveled: 0,
          shrapnel: false,
          railcannon: true,
        });
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      keys.current.add(e.key.toLowerCase());
      if (e.key.toLowerCase() === 'c' && !e.repeat) {
        setMenuVisible((prev) => !prev);
      }
      if (e.key.toLowerCase() === 'e') {
        if (Date.now() < G.playerStunUntil) return;
        const now = Date.now();
        if (noTimeSlowCooldownCheat || now > G.timeSlowCooldown) {
          G.timeSlow = true;
          if (!noTimeSlowCooldownCheat) {
            G.timeSlowCooldown = now + 10000;
          }
          scheduleTimeout(() => { G.timeSlow = false; }, 3500);
        }
      }
      if (e.key.toLowerCase() === 'q') {
        if (Date.now() < G.playerStunUntil) return;
        const now = Date.now();
        if (noMissileCooldownCheat || now > G.missileCooldown) {
          if (!noMissileCooldownCheat) {
            G.missileCooldown = now + 5000;
          }
          const allTargets: Array<{ id: number; type: Missile['targetType'] }> = [
            ...G.enemyShips.map(t => ({ id: t.id, type: 'ship' as const })),
            ...G.asteroids.map(t => ({ id: t.id, type: 'asteroid' as const })),
          ];
          if (allTargets.length > 0) {
            const shuffled = [...allTargets].sort(() => Math.random() - 0.5);
            const launchTargets: Array<{ id: number; type: Missile['targetType'] }> = [];
            if (shuffled.length === 1) {
              for (let i = 0; i < PLAYER_MISSILE_COUNT; i++) {
                launchTargets.push(shuffled[0]);
              }
            } else {
              const distinctCount = Math.min(PLAYER_MISSILE_COUNT, shuffled.length);
              for (let i = 0; i < distinctCount; i++) {
                launchTargets.push(shuffled[i]);
              }
              while (launchTargets.length < PLAYER_MISSILE_COUNT) {
                launchTargets.push(shuffled[launchTargets.length % distinctCount]);
              }
            }
            const isSingleTargetFocus = shuffled.length === 1;
            const missileDamage = isSingleTargetFocus
              ? PLAYER_MISSILE_SINGLE_TARGET_DAMAGE
              : PLAYER_MISSILE_BASE_DAMAGE;
            for (let i = 0; i < launchTargets.length; i++) {
              scheduleMissileLaunchToTarget(launchTargets[i].id, launchTargets[i].type, i * 100, missileDamage);
            }
          }
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    globalThis.addEventListener('mousemove', onMove);
    globalThis.addEventListener('mousedown', onDown);
    globalThis.addEventListener('mouseup', onUp);
    globalThis.addEventListener('mouseleave', stopPress);
    globalThis.addEventListener('blur', stopPress);
    globalThis.addEventListener('keydown', onKeyDown);
    globalThis.addEventListener('keyup', onKeyUp);
    return () => {
      globalThis.removeEventListener('mousemove', onMove);
      globalThis.removeEventListener('mousedown', onDown);
      globalThis.removeEventListener('mouseup', onUp);
      globalThis.removeEventListener('mouseleave', stopPress);
      globalThis.removeEventListener('blur', stopPress);
      globalThis.removeEventListener('keydown', onKeyDown);
      globalThis.removeEventListener('keyup', onKeyUp);
      mousePressed.current = false;
    };
  }, [scheduleTimeout, scheduleMissileLaunch, scheduleMissileLaunchToTarget, noTimeSlowCooldownCheat, noMissileCooldownCheat, fireSpinUpShot]);

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

    const scheduleNextWave = (delayMs: number, withWarning = true) => {
      if (cancelled) return;
      const nextWave = G.wave + 1;
      if (withWarning) {
        const warningTimeout = globalThis.setTimeout(() => {
          if (!cancelled && G.running) {
            playWaveMusicCue('incoming', nextWave);
          }
        }, Math.max(0, delayMs - WAVE_WARNING_MS));
        waveScheduleTimeouts.push(warningTimeout);
      }

      const startTimeout = globalThis.setTimeout(() => {
        if (cancelled || !G.running) return;
        if (G.disableEnemySpawns) {
          scheduleNextWave(1000, false);
          return;
        }
        if (G.enemyShips.some(enemyShip => enemyShip.type === 'tank')) {
          G.waveDelayBlockedByTank = true;
          scheduleNextWave(1000, false);
          return;
        }
        if (G.waveDelayBlockedByTank) {
          G.waveDelayBlockedByTank = false;
          scheduleNextWave(WAVE_INTERVAL_MS);
          return;
        }
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
    G.asteroids = []; G.bullets = []; G.enemyBullets = []; G.enemyShips = []; G.enemyMissiles = [];
    G.enemyBeams = [];
    G.particles = []; G.powerUps = []; G.activePowerUps = []; G.beams = []; G.missiles = [];
    G.ship = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    G.vel = { x: 0, y: 0 };
    G.hp = 100; G.playerStunUntil = 0; G.playerShield = G.playerBaseShieldMax; G.deathsDefied = 1; G.score = 0;
    G.invincible = false; G.deathDefied = false; G.timeSlow = false;
    G.disableEnemySpawns = enemySpawnCheatOff;
    G.deathDefiedSlowUntil = 0;
    G.timeSlowCooldown = 0; G.missileCooldown = 0;
    G.rapidSpinUp = 0; G.spreadSpinUp = 0;
    G.lastFrameAt = 0;
    G.lastShot = 0; G.lastHit = 0;
    G.lastPlayerDamageAt = Date.now();
    G.lastShieldRegenAt = G.lastPlayerDamageAt;
    G.wave = 0;
    G.waveSpawnEndsAt = 0;
    G.waveEndCuePlayed = true;
    G.waveDelayBlockedByTank = false;
    G.firstCaptainOverShieldDropped = false;
    G.lastMissileRicochetAt = 0;
    G.running = true;
    gameOverRef.current = false;
    keys.current.clear();
    mouseDownAt.current = 0;
    mousePressed.current = false;
    setMenuVisible(false);
    setGameOver(false);
    setGameStarted(true);
    setIsCharging(false);
  };

  const resetGame = () => {
    cancelAnimationFrame(rafRef.current);
    clearAllTimeouts();
    G.running = false;
    G.lastFrameAt = 0;
    setGameStarted(false);
    setGameOver(false);
    setMenuVisible(false);
    setIsCharging(false);
    mousePressed.current = false;
  };

  if (!mounted) return null;

  // Read from G for rendering (tick forces re-render each frame)
  const ship = G.ship;
  const mouse = G.mouse;
  const hpDisplayValue = Math.max(0, Math.round(G.hp));
  const hpDisplayColor = hpColor(G.hp, 100);
  const gameOverMessage = scoreMessage(G.score);
  const nowTs = Date.now();
  const timeSlowReady = noTimeSlowCooldownCheat || nowTs >= G.timeSlowCooldown;
  const missilesReady = noMissileCooldownCheat || nowTs >= G.missileCooldown;
  const playerStunned = nowTs < G.playerStunUntil;
  const recentMissileRicochet = nowTs - G.lastMissileRicochetAt < 900;
  const rapidActive = hasPU('rapidfire');
  const spreadActive = hasPU('spread');
  const deathDefiedAvailable = G.deathsDefied > 0;
  const deathDefiedDotColor = deathDefiedAvailable ? '#FFD700' : '#333';
  const deathDefiedDotShadow = deathDefiedAvailable ? '0 0 10px #FFD700,0 0 20px #FFA500' : 'none';
  const deathDefiedDotBorder = deathDefiedAvailable ? '#FFD700' : '#555';
  const deathDefiedSlowActive = nowTs < G.deathDefiedSlowUntil;
  const shipOpacity = G.invincible ? 0.5 : 1;
  const shipAnimation = G.invincible ? 'flash .2s infinite' : 'none';
  const hasOverShield = G.playerShield > G.playerBaseShieldMax;
  const shieldAuraColor = hasOverShield ? '#00ff66' : '#00ccff';
  const shieldFillColor = shieldAuraColor;
  const beamModeActive = !rapidActive && !spreadActive;
  let chargeColor = 'cyan';
  let chargeDurationMs = CHARGED_RAILCANNON_MAX_CHARGE_SECONDS * 1000;
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
        @keyframes shieldTextPulse { 0%,100%{opacity:0.85}50%{opacity:1} }
      `}</style>

      <div className="absolute inset-0 z-0">
        <PixelSnow color="#ffffff" flakeSize={0.01} minFlakeSize={1.25} pixelResolution={200} speed={1.25} depthFade={8} farPlane={20} brightness={0.7} gamma={0.4545} density={0.3} variant="snowflake" direction={125} />
      </div>

      {/* Time slow effect */}
      {(G.timeSlow || deathDefiedSlowActive) && (
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
              <div className="text-sm mb-1" style={{ color: hpDisplayColor }}>HP: {hpDisplayValue}/100</div>
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
            {recentMissileRicochet && <div className="mt-2 text-xs" style={{ color: '#7dd3fc', textShadow: '0 0 8px #7dd3fc' }}>MISSILE RICOCHET!</div>}
          </div>

          {menuVisible && (
          <div className="absolute top-5 right-5 z-20 font-mono text-xs text-white pointer-events-auto" style={{ width: 270, background: 'rgba(10,10,20,.78)', border: '1px solid #335', borderRadius: 8, padding: 10, boxShadow: '0 0 12px rgba(50,120,220,.25)', textShadow: '2px 2px 4px rgba(0,0,0,.8)' }}>
            <div style={{ color: '#7dd3fc', fontWeight: 'bold', marginBottom: 8 }}>MENU</div>

            {G.activePowerUps.filter(p => p.type !== 'shield' && p.type !== 'overshield').map((p) => (
              <div key={`${p.type}-${p.endTime}`} style={{ color: puColor(p.type), marginBottom: 5 }}>
                {p.type.toUpperCase()}: {Math.ceil((p.endTime - nowTs) / 1000)}s
              </div>
            ))}

            <div style={{ marginTop: 6, marginBottom: 8, borderTop: '1px solid #334155', paddingTop: 8 }}>
              <div className="mb-2 flex gap-2 items-center text-sm">
                <span style={{ color: '#0ff' }}>E - Time Slow:</span>
                {playerStunned ? <span style={{ color: '#d8b4fe' }}>LOCKED (STUN)</span> : (timeSlowReady ? <span style={{ color: '#0f0' }}>READY</span> : <span style={{ color: '#f66' }}>{Math.ceil((G.timeSlowCooldown - nowTs) / 1000)}s</span>)}
              </div>
              <div className="flex gap-2 items-center text-sm">
                <span style={{ color: '#f80' }}>Q - Missiles:</span>
                {playerStunned ? <span style={{ color: '#d8b4fe' }}>LOCKED (STUN)</span> : (missilesReady ? <span style={{ color: '#0f0' }}>READY</span> : <span style={{ color: '#f66' }}>{Math.ceil((G.missileCooldown - nowTs) / 1000)}s</span>)}
              </div>
            </div>

            <div style={{ borderTop: '1px solid #334155', paddingTop: 8 }}>
              <div style={{ color: '#7dd3fc', fontWeight: 'bold', marginBottom: 6 }}>CHEATS</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={enemySpawnCheatOff}
                  onChange={(e) => setDisableEnemySpawnCheat(e.target.checked)}
                  style={{ accentColor: '#38bdf8' }}
                />
                <span style={{ color: enemySpawnCheatOff ? '#fca5a5' : '#9ca3af' }}>Disable enemy auto spawns</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={noTimeSlowCooldownCheat}
                  onChange={(e) => setNoTimeSlowCooldownCheat(e.target.checked)}
                  style={{ accentColor: '#38bdf8' }}
                />
                <span style={{ color: noTimeSlowCooldownCheat ? '#86efac' : '#9ca3af' }}>No cooldown: Time Slow</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={noMissileCooldownCheat}
                  onChange={(e) => setNoMissileCooldownCheat(e.target.checked)}
                  style={{ accentColor: '#38bdf8' }}
                />
                <span style={{ color: noMissileCooldownCheat ? '#86efac' : '#9ca3af' }}>No cooldown: Missiles</span>
              </label>

              <div style={{ color: '#94a3b8', marginBottom: 6 }}>Grant pickups / charges</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 6, marginBottom: 8 }}>
                <button type="button" onClick={grantDeathDefiedCheat} style={{ cursor: 'pointer', fontSize: 10, padding: '5px 6px', borderRadius: 6, border: '1px solid #355', background: 'rgba(26,36,52,.9)', color: '#fef08a' }}>+ Death Defied</button>
                <button type="button" onClick={() => grantPickableCheat('health')} style={{ cursor: 'pointer', fontSize: 10, padding: '5px 6px', borderRadius: 6, border: '1px solid #355', background: 'rgba(26,36,52,.9)', color: '#86efac' }}>+ Health</button>
                <button type="button" onClick={() => grantPickableCheat('shield')} style={{ cursor: 'pointer', fontSize: 10, padding: '5px 6px', borderRadius: 6, border: '1px solid #355', background: 'rgba(26,36,52,.9)', color: '#67e8f9' }}>+ Shield</button>
                <button type="button" onClick={() => grantPickableCheat('overshield')} style={{ cursor: 'pointer', fontSize: 10, padding: '5px 6px', borderRadius: 6, border: '1px solid #355', background: 'rgba(26,36,52,.9)', color: '#4ade80' }}>+ Overshield</button>
                <button type="button" onClick={() => grantPickableCheat('rapidfire')} style={{ cursor: 'pointer', fontSize: 10, padding: '5px 6px', borderRadius: 6, border: '1px solid #355', background: 'rgba(26,36,52,.9)', color: '#fde047' }}>+ Rapidfire</button>
                <button type="button" onClick={() => grantPickableCheat('spread')} style={{ cursor: 'pointer', fontSize: 10, padding: '5px 6px', borderRadius: 6, border: '1px solid #355', background: 'rgba(26,36,52,.9)', color: '#f0abfc' }}>+ Spread</button>
              </div>

              <div style={{ color: '#94a3b8', marginBottom: 6 }}>Direct enemy spawn</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 6 }}>
                {(['fighter', 'sniper', 'captain', 'aggressive', 'grenadier', 'tank'] as EnemyShip['type'][]).map((enemyType) => (
                  <button
                    key={enemyType}
                    type="button"
                    onClick={() => manualSpawnEnemy(enemyType)}
                    style={{ cursor: 'pointer', fontSize: 10, padding: '5px 6px', borderRadius: 6, border: '1px solid #355', background: 'rgba(26,36,52,.9)', color: '#e5e7eb' }}
                  >
                    {enemyType.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>
          )}

          <div className="absolute bottom-5 left-5 z-10 font-mono text-sm text-white opacity-70">
            <div>WASD / Arrows: Move</div>
            <div style={{ color: '#ff0' }}>Click: Shoot &nbsp; <span style={{ color: '#0ff' }}>Hold: Charge Railcannon</span></div>
            <div className="mt-1" style={{ color: '#f44' }}>Watch out for enemy ships!</div>
            <div className="mt-1" style={{ color: '#7dd3fc' }}>Press C: Toggle Menu</div>
          </div>
        </>
      )}

      {/* Start screen */}
      {!gameStarted && !gameOver && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center text-white font-mono text-center cursor-default">
          <h1 className="text-6xl mb-5" style={{ textShadow: '0 0 20px cyan,0 0 40px cyan', letterSpacing: 5 }}>ASTEROID DEFENDER</h1>
          <div className="text-lg mb-10 text-gray-400 leading-loose">
            <p>WASD / Arrows to move &nbsp;|&nbsp; Mouse to aim</p>
            <p><span style={{ color: '#ff0' }}>Click: shoot</span> &nbsp;|&nbsp; <span style={{ color: '#0ff' }}>Hold: charge railcannon</span></p>
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
            {nowTs < G.playerStunUntil && (
              <div style={{ position: 'absolute', left: '50%', top: -30, transform: 'translateX(-50%)', color: '#d8b4fe', fontSize: 10, fontFamily: 'monospace', fontWeight: 'bold', letterSpacing: 1, textShadow: '0 0 8px #d8b4fe,0 0 14px #a78bfa', whiteSpace: 'nowrap' }}>
                STUNNED
              </div>
            )}
            {G.deathDefied && (
              <div style={{ position: 'absolute', left: '50%', top: -16, transform: 'translateX(-50%)', color: '#FFD700', fontSize: 10, fontFamily: 'monospace', fontWeight: 'bold', letterSpacing: 1, textShadow: '0 0 8px #FFD700, 0 0 14px #FFB300', whiteSpace: 'nowrap', animation: 'shieldTextPulse .8s ease-in-out infinite' }}>
                SHIELD
              </div>
            )}
            <svg width="40" height="40" viewBox="0 0 40 40">
              {G.deathDefied && <circle cx="20" cy="20" r="18" fill="none" stroke="#FFD700" strokeWidth="3" opacity="0.95" style={{ filter: 'drop-shadow(0 0 8px #FFD700)' }} />}
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
                ) : s.type === 'tank' ? (
                  <>
                    <rect x="5" y="7" width="26" height="22" rx="3" fill="rgba(110,90,180,.9)" stroke="#a78bfa" strokeWidth="2" />
                    <rect x="14" y="2" width="8" height="8" rx="2" fill="#c4b5fd" stroke="#ddd6fe" strokeWidth="1.5" />
                    <line x1="18" y1="2" x2="18" y2="-7" stroke="#ddd6fe" strokeWidth="2" />
                    {s.shield > 0 && <circle cx="18" cy="18" r="16" fill="none" stroke="#c4b5fd" strokeWidth="2" opacity="0.75" />}
                  </>
                ) : (
                  <polygon points="18,2 34,34 18,26 2,34" fill="rgba(180,0,0,.85)" stroke="#f44" strokeWidth="2" />
                )}
              </svg>
              <div style={{ position: 'absolute', bottom: -8, left: '50%', transform: 'translateX(-50%)', width: 36, height: 3, background: '#333', borderRadius: 2 }}>
                <div style={{ width: `${s.hp / s.maxHp * 100}%`, height: '100%', background: s.type === 'tank' ? '#a78bfa' : s.type === 'sniper' ? '#f6f' : s.type === 'captain' ? '#7dd3fc' : s.type === 'aggressive' ? '#ff9933' : s.type === 'grenadier' ? '#88cc44' : '#f44', borderRadius: 2 }} />
              </div>
              {s.maxShield > 0 && (
                <div style={{ position: 'absolute', bottom: -13, left: '50%', transform: 'translateX(-50%)', width: 36, height: 2, background: '#223', borderRadius: 2 }}>
                  <div style={{ width: `${(s.shield / s.maxShield) * 100}%`, height: '100%', background: '#67e8f9', borderRadius: 2 }} />
                </div>
              )}
              <div style={{ position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)', fontSize: 9, fontFamily: 'monospace', color: s.type === 'tank' ? '#d8b4fe' : s.type === 'captain' ? '#7dd3fc' : s.type === 'aggressive' ? '#ffb366' : s.type === 'sniper' ? '#ff88ff' : s.type === 'grenadier' ? '#99dd55' : '#ff6666' }}>
                {s.type.toUpperCase()}
              </div>
            </div>
          ))}

          {/* Enemy beams */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            {G.enemyBeams.map(beam => (
              <g key={beam.id}>
                <line
                  x1={beam.x1}
                  y1={beam.y1}
                  x2={beam.x2}
                  y2={beam.y2}
                  stroke={beam.type === 'telegraph' ? '#ff66ff' : beam.type === 'tankGrenade' ? '#f5d76e' : beam.type === 'tankSnap' ? '#a78bfa' : beam.type === 'tankSnapStrike' ? '#f0abfc' : '#ff1177'}
                  strokeWidth={beam.type === 'telegraph' ? 3 : beam.type === 'tankSnap' ? 3 : beam.type === 'tankSnapStrike' ? 8 : beam.type === 'tankGrenade' ? 5 : 6}
                  opacity={beam.type === 'telegraph' ? '.45' : beam.type === 'tankSnap' ? '.35' : beam.type === 'tankSnapStrike' ? '.68' : beam.type === 'tankGrenade' ? '.35' : '.35'}
                  strokeDasharray={beam.type === 'telegraph' ? '8,6' : beam.type === 'tankSnap' ? '7,7' : beam.type === 'tankGrenade' ? '2,6' : undefined}
                  strokeLinecap="round"
                />
                <line
                  x1={beam.x1}
                  y1={beam.y1}
                  x2={beam.x2}
                  y2={beam.y2}
                  stroke={beam.type === 'telegraph' ? '#ffe6ff' : beam.type === 'tankGrenade' ? '#fff2b0' : beam.type === 'tankSnap' ? '#ddd6fe' : beam.type === 'tankSnapStrike' ? '#fdf4ff' : '#ffd1f0'}
                  strokeWidth={beam.type === 'telegraph' ? 1.5 : beam.type === 'tankSnap' ? 1.5 : beam.type === 'tankSnapStrike' ? 2.8 : beam.type === 'tankGrenade' ? 2 : 2}
                  opacity={beam.type === 'telegraph' ? '.65' : beam.type === 'tankSnap' ? '.7' : beam.type === 'tankSnapStrike' ? '.95' : beam.type === 'tankGrenade' ? '.8' : '.85'}
                  strokeLinecap="round"
                />
              </g>
            ))}
          </svg>

          {/* Enemy bullets */}
          {G.enemyBullets.map(b => (
            <div key={b.id} className="absolute w-1.5 h-1.5 rounded-full" style={{ left: b.x, top: b.y, transform: 'translate(-50%,-50%)', backgroundColor: b.color || '#f44', boxShadow: `0 0 6px ${b.color || '#f44'}` }} />
          ))}

          {/* Enemy missiles */}
          {G.enemyMissiles.map(m => (
            <div key={m.id} className="absolute w-3 h-4 rounded" style={{ left: m.x, top: m.y, transform: 'translate(-50%,-50%)', background: m.type === 'tankGrenade' ? 'linear-gradient(to bottom, #f5d76e, #d4a838)' : m.type === 'tankSnap' ? 'linear-gradient(to bottom, #c4b5fd, #8b5cf6)' : 'linear-gradient(to bottom, #88cc44, #ddff88)', boxShadow: m.type === 'tankGrenade' ? '0 0 10px rgba(245,215,110,.95)' : m.type === 'tankSnap' ? '0 0 10px rgba(168,139,250,.95)' : '0 0 8px rgba(136,204,68,.9)' }}>
              {m.type === 'tankGrenade' && (
                <div style={{ position: 'absolute', left: '50%', top: -14, transform: 'translateX(-50%)', width: 16, height: 2, background: 'rgba(40,30,10,.7)', borderRadius: 2 }}>
                  <div style={{ width: `${Math.max(0, Math.min(100, (((m.explodesAt ?? nowTs) - nowTs) / TANK_GRENADE_LIFE_MS) * 100))}%`, height: '100%', background: '#f5d76e', borderRadius: 2 }} />
                </div>
              )}
            </div>
          ))}

          {/* Asteroids */}
          {G.asteroids.map(a => {
            const col = asteroidStrokeColor(a.type);
            const asteroidHpColor = hpColor(a.hp, a.maxHp);
            const asteroidStunned = nowTs < (a.stunnedUntil ?? 0);
            return (
              <div key={a.id} className="asteroid-target absolute pointer-events-auto" style={{ left: a.x, top: a.y, width: a.size * 2, height: a.size * 2, transform: `translate(-50%,-50%) rotate(${a.rotation}deg)` }}>
                <svg width={a.size * 2} height={a.size * 2} viewBox="0 0 100 100">
                  <polygon points="50,5 80,25 85,60 60,90 30,85 10,60 15,25" fill={asteroidStunned ? 'rgba(150,130,190,.85)' : 'rgba(100,100,100,.8)'} stroke={asteroidStunned ? '#c4b5fd' : col} strokeWidth={a.type === 'armored' ? 4 : 2} />
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
            <div
              key={b.id}
              className={`absolute ${b.railcannon ? '' : 'w-1.5 h-1.5 rounded-full'}`}
              style={b.railcannon
                ? {
                    left: b.x,
                    top: b.y,
                    width: 22,
                    height: 4,
                    borderRadius: 999,
                    background: 'linear-gradient(to right, rgba(255,255,255,.4), #67e8f9, #ffffff)',
                    transform: `translate(-50%,-50%) rotate(${Math.atan2(b.vy, b.vx)}rad)`,
                    boxShadow: '0 0 16px #67e8f9, 0 0 28px rgba(103,232,249,.9)',
                  }
                : {
                    left: b.x,
                    top: b.y,
                    transform: 'translate(-50%,-50%)',
                    backgroundColor: b.shrapnel ? '#34d399' : '#facc15',
                    boxShadow: b.shrapnel ? '0 0 9px #34d399' : '0 0 10px yellow',
                  }}
            />
          ))}

          {/* Missiles */}
          {G.missiles.map(m => (
            <div key={m.id} className="absolute w-2 h-3 rounded-full" style={{ left: m.x, top: m.y, transform: 'translate(-50%,-50%)', background: m.ricochetCount > 0 ? 'linear-gradient(to bottom, #7dd3fc, #38bdf8)' : 'linear-gradient(to bottom, #f97316, #dc2626)', boxShadow: m.ricochetCount > 0 ? '0 0 10px rgba(125,211,252,.95)' : '0 0 8px rgba(255,100,0,.8)' }} />
          ))}

          {/* Particles */}
          {G.particles.map(p => {
            const particleColor = p.color || `rgba(255,${Math.floor(255 * p.life)},0,${p.life})`;
            return (
              <div key={p.id} className="absolute rounded-full" style={{ left: p.x, top: p.y, width: p.size, height: p.size, transform: 'translate(-50%,-50%)', backgroundColor: particleColor, boxShadow: `0 0 ${p.size * 2}px ${particleColor}` }} />
            );
          })}

          {/* Beams */}
          {(G.beams.length > 0 || (beamModeActive && isCharging)) && (
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
              {beamModeActive && isCharging && (
                <line x1={ship.x} y1={ship.y} x2={mouse.x} y2={mouse.y} stroke={chargeColor} strokeWidth="2" opacity=".5" strokeDasharray="5,5">
                  <animate attributeName="stroke-dashoffset" values="0;10" dur=".3s" repeatCount="indefinite" />
                </line>
              )}
            </svg>
          )}

          {/* Charge bar */}
          {beamModeActive && isCharging && (
            <div className="absolute pointer-events-none" style={{ left: ship.x, top: ship.y - 42, transform: 'translateX(-50%)' }}>
              <div style={{ width: 60, height: 6, background: '#333', borderRadius: 3, border: `1px solid ${chargeColor}` }}>
                <div style={{ width: `${Math.min(100, ((Date.now() - mouseDownAt.current) / (playerStunned ? chargeDurationMs * 1.3 : chargeDurationMs)) * 100)}%`, height:'100%', borderRadius:3, backgroundColor: chargeColor }} />
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