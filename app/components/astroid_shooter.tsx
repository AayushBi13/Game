"use client";
import React, { useState, useEffect, useRef, useCallback } from 'react';
import Crosshair from '@/app/components/crosshair';
import TargetCursor from '@/components/TargetCursor';
import PixelSnow from '@/app/components/snow';

interface Asteroid {
  id: number;
  x: number;
  y: number;
  size: number;
  speedX: number;
  speedY: number;
  rotation: number;
  rotationSpeed: number;
  hp: number;
  maxHp: number;
  type: 'normal' | 'fast' | 'armored' | 'splitting';
}

interface Bullet {
  id: number;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
}

interface Particle {
  id: number;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  life: number;
  size: number;
  color?: string;
}

interface BeamWeapon {
  id: number;
  active: boolean;
  startTime: number;
  targetX: number;
  targetY: number;
  damage: number;
}

interface PowerUp {
  id: number;
  x: number;
  y: number;
  type: 'shield' | 'rapidfire' | 'spread' | 'health';
  speedY: number;
}

interface ActivePowerUp {
  type: string;
  endTime: number;
  startTime: number; // Track when power-up was activated for spin-up
}

export default function AsteroidShooter() {
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [shields, setShields] = useState(0); // Shield count (max 5)
  const [gameOver, setGameOver] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [asteroids, setAsteroids] = useState<Asteroid[]>([]);
  const [bullets, setBullets] = useState<Bullet[]>([]);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [powerUps, setPowerUps] = useState<PowerUp[]>([]);
  const [activePowerUps, setActivePowerUps] = useState<ActivePowerUp[]>([]);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [shipPos, setShipPos] = useState({ x: 0, y: 0 });
  const [shipVelocity, setShipVelocity] = useState({ x: 0, y: 0 });
  const [lockedTarget, setLockedTarget] = useState<Asteroid | null>(null);
  const [mounted, setMounted] = useState(false);
  const [beams, setBeams] = useState<BeamWeapon[]>([]);
  const [isCharging, setIsCharging] = useState(false);
  const [invincible, setInvincible] = useState(false);
  const [showCheatMenu, setShowCheatMenu] = useState(false);
  const keysPressed = useRef<Set<string>>(new Set());
  const mouseDownTime = useRef<number>(0);
  const beamInterval = useRef<number>(0);
  const lastCollisionTime = useRef<number>(0);
  const lastShotTime = useRef<number>(0);
  const currentMousePos = useRef({ x: 0, y: 0 });
  const lockedTargetRef = useRef<Asteroid | null>(null);
  
  const nextAsteroidId = useRef(0);
  const nextBulletId = useRef(0);
  const nextParticleId = useRef(0);
  const nextPowerUpId = useRef(0);
  const nextBeamId = useRef(0);
  const gameLoopRef = useRef<number>(0);
  const activePowerUpsRef = useRef<ActivePowerUp[]>([]);

  // Keep ref in sync with state
  useEffect(() => {
    activePowerUpsRef.current = activePowerUps;
  }, [activePowerUps]);

  // Initialize after mount to avoid SSR issues
  useEffect(() => {
    setMounted(true);
    setShipPos({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  }, []);

  // Check if power-up is active
  const hasPowerUp = useCallback((type: string) => {
    return activePowerUps.some(p => p.type === type && Date.now() < p.endTime);
  }, [activePowerUps]);

  // Spawn power-up
  const spawnPowerUp = useCallback((x: number, y: number) => {
    const types: PowerUp['type'][] = ['shield', 'rapidfire', 'spread', 'health'];
    const type = types[Math.floor(Math.random() * types.length)];
    
    const newPowerUp: PowerUp = {
      id: nextPowerUpId.current++,
      x,
      y,
      type,
      speedY: 0.3 + Math.random() * 0.5 // Reduced from 1 + Math.random() * 1.5
    };
    
    setPowerUps(prev => [...prev, newPowerUp]);
  }, []);

  // Spawn smaller asteroids when splitting type is destroyed
  const spawnSplitAsteroids = useCallback((x: number, y: number, count: number = 3) => {
    const newAsteroids: Asteroid[] = [];
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const speed = 1 + Math.random() * 1.5;
      
      newAsteroids.push({
        id: nextAsteroidId.current++,
        x,
        y,
        size: 20,
        speedX: Math.cos(angle) * speed,
        speedY: Math.sin(angle) * speed,
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 3,
        hp: 1,
        maxHp: 1,
        type: 'fast'
      });
    }
    setAsteroids(prev => [...prev, ...newAsteroids]);
  }, []);

  // Spawn asteroids with different types
  const spawnAsteroid = useCallback(() => {
    const side = Math.floor(Math.random() * 4);
    let x, y, speedX, speedY;
    
    const speed = 0.3 + Math.random() * 0.5;
    const angle = Math.random() * Math.PI * 2;
    
    switch(side) {
      case 0: // top
        x = Math.random() * window.innerWidth;
        y = -50;
        speedX = Math.cos(angle) * speed;
        speedY = Math.abs(Math.sin(angle)) * speed;
        break;
      case 1: // right
        x = window.innerWidth + 50;
        y = Math.random() * window.innerHeight;
        speedX = -Math.abs(Math.cos(angle)) * speed;
        speedY = Math.sin(angle) * speed;
        break;
      case 2: // bottom
        x = Math.random() * window.innerWidth;
        y = window.innerHeight + 50;
        speedX = Math.cos(angle) * speed;
        speedY = -Math.abs(Math.sin(angle)) * speed;
        break;
      default: // left
        x = -50;
        y = Math.random() * window.innerHeight;
        speedX = Math.abs(Math.cos(angle)) * speed;
        speedY = Math.sin(angle) * speed;
    }

    // Determine asteroid type (60% normal, 20% fast, 15% armored, 5% splitting)
    const rand = Math.random();
    let type: Asteroid['type'];
    let size: number;
    let baseHp: number;
    let speedMultiplier = 1;

    if (rand < 0.6) {
      type = 'normal';
      size = 30 + Math.random() * 40;
      baseHp = size >= 60 ? 8 : size >= 50 ? 5 : size >= 40 ? 3 : 2;
    } else if (rand < 0.8) {
      type = 'fast';
      size = 20 + Math.random() * 20;
      baseHp = 2;
      speedMultiplier = 2;
    } else if (rand < 0.95) {
      type = 'armored';
      size = 60 + Math.random() * 20;
      baseHp = 15;
      speedMultiplier = 0.5;
    } else {
      type = 'splitting';
      size = 40 + Math.random() * 20;
      baseHp = 4;
    }

    const newAsteroid: Asteroid = {
      id: nextAsteroidId.current++,
      x,
      y,
      size,
      speedX: speedX * speedMultiplier,
      speedY: speedY * speedMultiplier,
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 2,
      hp: baseHp,
      maxHp: baseHp,
      type
    };

    setAsteroids(prev => [...prev, newAsteroid]);
  }, []);

  // Spawn particles for explosion effect
  const spawnParticles = useCallback((x: number, y: number, count: number = 8, color?: string) => {
    const newParticles: Particle[] = [];
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count;
      const speed = 2 + Math.random() * 3;
      newParticles.push({
        id: nextParticleId.current++,
        x,
        y,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed,
        life: 1,
        size: 3 + Math.random() * 3,
        color: color || undefined
      });
    }
    setParticles(prev => [...prev, ...newParticles]);
  }, []);

  // Shoot bullet (quick tap)
  const shootBullet = useCallback((mouseX: number, mouseY: number) => {
    if (gameOver || !gameStarted) return;

    const now = Date.now();
    const hasRapid = hasPowerUp('rapidfire');
    const hasSpread = hasPowerUp('spread');
    
    // Calculate fire rate with spin-up
    let fireRate = 250; // Default
    
    if (hasRapid) {
      // Rapid fire: 100ms -> 10ms over 15 seconds
      const rapidPowerUp = activePowerUps.find(p => p.type === 'rapidfire' && now < p.endTime);
      if (rapidPowerUp) {
        const elapsedTime = now - rapidPowerUp.startTime;
        const spinUpDuration = 15000; // 15 seconds to reach max speed
        const progress = Math.min(1, elapsedTime / spinUpDuration);
        
        // Interpolate from 100ms to 10ms
        fireRate = 100 - (progress * 90); // 100 -> 10
        
        console.log('Rapid Fire - elapsed:', (elapsedTime/1000).toFixed(1), 's, progress:', (progress*100).toFixed(1), '%, fireRate:', fireRate.toFixed(1), 'ms');
      }
    } else if (hasSpread) {
      // Spread shot: 250ms -> 150ms over 5 seconds
      const spreadPowerUp = activePowerUps.find(p => p.type === 'spread' && now < p.endTime);
      if (spreadPowerUp) {
        const elapsedTime = now - spreadPowerUp.startTime;
        const spinUpDuration = 5000; // 5 seconds to reach max speed
        const progress = Math.min(1, elapsedTime / spinUpDuration);
        
        // Interpolate from 250ms to 150ms
        fireRate = 250 - (progress * 100); // 250 -> 150
        
        console.log('Spread Shot - elapsed:', (elapsedTime/1000).toFixed(1), 's, progress:', (progress*100).toFixed(1), '%, fireRate:', fireRate.toFixed(1), 'ms');
      }
    }
    
    // Check if enough time has passed since last shot
    const timeSinceLastShot = now - lastShotTime.current;
    if (timeSinceLastShot < fireRate) {
      console.log('Rate limited - need', fireRate.toFixed(1), 'ms, only', timeSinceLastShot.toFixed(1), 'ms passed');
      return;
    }
    
    lastShotTime.current = now;

    const dx = mouseX - shipPos.x;
    const dy = mouseY - shipPos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const speed = 6;

    const bulletCount = hasSpread ? 3 : 1;
    const spreadAngle = 0.3;

    for (let i = 0; i < bulletCount; i++) {
      const offset = hasSpread ? (i - 1) * spreadAngle : 0;
      const angle = Math.atan2(dy, dx) + offset;
      
      const newBullet: Bullet = {
        id: nextBulletId.current++,
        x: shipPos.x,
        y: shipPos.y,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed
      };

      setBullets(prev => [...prev, newBullet]);
    }
    
    console.log('FIRED! Next shot in', fireRate.toFixed(1), 'ms');
  }, [gameOver, gameStarted, shipPos, hasPowerUp, activePowerUps]);

  // Handle mouse down - start charging
  const handleMouseDown = useCallback((e: MouseEvent) => {
    if (gameOver || !gameStarted) return;
    
    mouseDownTime.current = Date.now();
    setIsCharging(true);
  }, [gameOver, gameStarted]);

  // Handle mouse up - fire beam or bullet (modified by power-ups)
  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (gameOver || !gameStarted) return;
    
    const holdDuration = (Date.now() - mouseDownTime.current) / 1000;
    setIsCharging(false);
    
    const hasRapid = hasPowerUp('rapidfire');
    const hasSpread = hasPowerUp('spread');
    
    if (holdDuration < 0.1) {
      // Quick tap - shoot bullet
      shootBullet(e.clientX, e.clientY);
    } else {
      // Held - fire beam (modified by power-ups)
      let damage: number;
      let maxDamage: number;
      let chargeTime: number;
      let beamColor: string = 'cyan';
      
      // Rapid fire modifies beam to fire 3 consecutive beams
      if (hasRapid) {
        maxDamage = 8;
        chargeTime = 0.5; // 0.5 seconds to max charge
        damage = Math.min(maxDamage, 2 + (holdDuration * (maxDamage - 2) / chargeTime));
        beamColor = '#ffff00'; // Yellow
        
        // Fire 3 beams in quick succession
        for (let i = 0; i < 3; i++) {
          setTimeout(() => {
            const beamId = nextBeamId.current++;
            const newBeam: BeamWeapon = {
              id: beamId,
              active: true,
              startTime: Date.now(),
              targetX: e.clientX,
              targetY: e.clientY,
              damage: damage
            };
            
            setBeams(prev => [...prev, newBeam]);
            
            // Remove beam after 120ms (so beams are distinct with 150ms spacing)
            setTimeout(() => {
              setBeams(prev => prev.filter(b => b.id !== beamId));
            }, 120);
          }, i * 150); // 150ms apart
        }
        
        mouseDownTime.current = 0;
        return;
      }
      // Spread shot modifies beam to be wider and more powerful
      else if (hasSpread) {
        chargeTime = 4.0; // 4 seconds to max charge
        const baseDamage = 11;
        // Use min to cap at 4 seconds, so damage caps at 44
        const chargeProgress = Math.min(1, holdDuration / chargeTime);
        const chargeMultiplier = 1 + (chargeProgress * 3); // 1x to 4x
        damage = baseDamage * chargeMultiplier; // 11 to 44 damage
        beamColor = '#ff00ff'; // Purple
        
        console.log('Spread Shot Beam - holdDuration:', holdDuration.toFixed(2), 's, chargeProgress:', (chargeProgress * 100).toFixed(1), '%, damage:', damage.toFixed(1));
      }
      // Normal beam
      else {
        maxDamage = 10;
        chargeTime = 1.0;
        damage = Math.min(maxDamage, 2 + (holdDuration * (maxDamage - 2) / chargeTime));
      }
      
      const beamId = nextBeamId.current++;
      const newBeam: BeamWeapon = {
        id: beamId,
        active: true,
        startTime: Date.now(),
        targetX: e.clientX,
        targetY: e.clientY,
        damage: damage
      };
      
      setBeams(prev => [...prev, newBeam]);
      
      // Beam persists for 500ms (about 30 frames at 60fps)
      setTimeout(() => {
        setBeams(prev => prev.filter(b => b.id !== beamId));
      }, 500);
    }
    
    mouseDownTime.current = 0;
  }, [gameOver, gameStarted, shootBullet, hasPowerUp]);

  // Track mouse position and keyboard
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      currentMousePos.current = { x: e.clientX, y: e.clientY };
      setMousePos({ x: e.clientX, y: e.clientY });
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      keysPressed.current.add(e.key.toLowerCase());
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysPressed.current.delete(e.key.toLowerCase());
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleMouseDown, handleMouseUp, isCharging]);

  // Spawn asteroids periodically
  useEffect(() => {
    if (gameOver || !gameStarted) return;

    const interval = setInterval(() => {
      spawnAsteroid();
    }, 3000);

    for (let i = 0; i < 3; i++) {
      setTimeout(() => spawnAsteroid(), i * 800);
    }

    return () => clearInterval(interval);
  }, [gameOver, gameStarted, spawnAsteroid]);

  // Game loop
  useEffect(() => {
    if (gameOver || !gameStarted) return;

    const gameLoop = () => {
      // Update ship position based on keyboard input
      setShipVelocity(prev => {
        let newVelX = prev.x;
        let newVelY = prev.y;
        const acceleration = 0.3;
        const maxSpeed = 3;
        const friction = 0.92;

        if (keysPressed.current.has('w') || keysPressed.current.has('arrowup')) {
          newVelY -= acceleration;
        }
        if (keysPressed.current.has('s') || keysPressed.current.has('arrowdown')) {
          newVelY += acceleration;
        }
        if (keysPressed.current.has('a') || keysPressed.current.has('arrowleft')) {
          newVelX -= acceleration;
        }
        if (keysPressed.current.has('d') || keysPressed.current.has('arrowright')) {
          newVelX += acceleration;
        }

        newVelX *= friction;
        newVelY *= friction;

        const speed = Math.sqrt(newVelX * newVelX + newVelY * newVelY);
        if (speed > maxSpeed) {
          newVelX = (newVelX / speed) * maxSpeed;
          newVelY = (newVelY / speed) * maxSpeed;
        }

        return { x: newVelX, y: newVelY };
      });

      setShipPos(prev => {
        const newX = Math.max(30, Math.min(window.innerWidth - 30, prev.x + shipVelocity.x));
        const newY = Math.max(30, Math.min(window.innerHeight - 30, prev.y + shipVelocity.y));
        return { x: newX, y: newY };
      });

      // Update power-ups
      setPowerUps(prev => {
        const updated = prev.map(powerUp => ({
          ...powerUp,
          y: powerUp.y + powerUp.speedY
        })).filter(powerUp => powerUp.y < window.innerHeight + 50);

        // Check collision with ship
        const remaining = updated.filter(powerUp => {
          const dx = powerUp.x - shipPos.x;
          const dy = powerUp.y - shipPos.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          if (distance < 30) {
            // Collect power-up
            let duration = 10000; // 10 seconds default
            
            // Different durations for different power-ups
            if (powerUp.type === 'rapidfire') {
              duration = 30000; // 30 seconds
            } else if (powerUp.type === 'spread') {
              duration = 30000; // 30 seconds
            }
            
            if (powerUp.type === 'health') {
              setLives(l => Math.min(5, l + 1));
            } else if (powerUp.type === 'shield') {
              setShields(s => Math.min(5, s + 1));
            } else {
              // If picking up rapidfire or spread, remove the other one
              if (powerUp.type === 'rapidfire' || powerUp.type === 'spread') {
                setActivePowerUps(prev => [
                  ...prev.filter(p => p.type !== 'rapidfire' && p.type !== 'spread'),
                  { type: powerUp.type, endTime: Date.now() + duration, startTime: Date.now() }
                ]);
              } else {
                setActivePowerUps(prev => [
                  ...prev.filter(p => p.type !== powerUp.type),
                  { type: powerUp.type, endTime: Date.now() + duration, startTime: Date.now() }
                ]);
              }
            }
            
            spawnParticles(powerUp.x, powerUp.y, 12, getPowerUpColor(powerUp.type));
            return false;
          }
          return true;
        });

        return remaining;
      });

      // Clean up expired power-ups
      setActivePowerUps(prev => prev.filter(p => Date.now() < p.endTime));

      // Update asteroids
      setAsteroids(prev => {
        const updated = prev.map(asteroid => ({
          ...asteroid,
          x: asteroid.x + asteroid.speedX,
          y: asteroid.y + asteroid.speedY,
          rotation: asteroid.rotation + asteroid.rotationSpeed
        })).filter(asteroid => {
          return asteroid.x > -100 && asteroid.x < window.innerWidth + 100 &&
                 asteroid.y > -100 && asteroid.y < window.innerHeight + 100;
        });

        // Check collision with ship
        const hasShield = shields > 0;
        const isInvulnerable = invincible || hasShield;
        
        if (!invincible) {
          const currentTime = Date.now();
          const cooldownPeriod = 2000;
          
          const remainingAsteroids = updated.filter(asteroid => {
            const dx = asteroid.x - shipPos.x;
            const dy = asteroid.y - shipPos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < asteroid.size + 20) {
              if (currentTime - lastCollisionTime.current >= cooldownPeriod) {
                lastCollisionTime.current = currentTime;
                
                // Consume shield first, then life
                if (shields > 0) {
                  setShields(s => s - 1);
                } else {
                  setLives(l => {
                    const newLives = l - 1;
                    if (newLives <= 0) {
                      setGameOver(true);
                    }
                    return newLives;
                  });
                }
                
                setInvincible(true);
                setTimeout(() => setInvincible(false), cooldownPeriod);
                
                spawnParticles(asteroid.x, asteroid.y, 12);
              }
              return false;
            }
            return true;
          });
          
          updateLockedTarget(remainingAsteroids);
          return remainingAsteroids;
        } else {
          updateLockedTarget(updated);
          return updated;
        }
      });

      // Update bullets
      setBullets(prev => 
        prev.map(bullet => ({
          ...bullet,
          x: bullet.x + bullet.velocityX,
          y: bullet.y + bullet.velocityY
        })).filter(bullet => 
          bullet.x > 0 && bullet.x < window.innerWidth &&
          bullet.y > 0 && bullet.y < window.innerHeight
        )
      );

      // Update particles
      setParticles(prev => 
        prev.map(particle => ({
          ...particle,
          x: particle.x + particle.velocityX,
          y: particle.y + particle.velocityY,
          life: particle.life - 0.02,
          velocityX: particle.velocityX * 0.98,
          velocityY: particle.velocityY * 0.98
        })).filter(particle => particle.life > 0)
      );

      // Check bullet-asteroid collisions
      setBullets(prevBullets => {
        const remainingBullets = [...prevBullets];
        
        setAsteroids(prevAsteroids => {
          let updatedAsteroids = [...prevAsteroids];
          
          for (let i = remainingBullets.length - 1; i >= 0; i--) {
            const bullet = remainingBullets[i];
            
            for (let j = updatedAsteroids.length - 1; j >= 0; j--) {
              const asteroid = updatedAsteroids[j];
              const dx = bullet.x - asteroid.x;
              const dy = bullet.y - asteroid.y;
              const distance = Math.sqrt(dx * dx + dy * dy);
              
              if (distance < asteroid.size) {
                asteroid.hp -= 2;
                
                if (asteroid.hp <= 0) {
                  // Asteroid destroyed
                  const particleColor = getAsteroidColor(asteroid.type);
                  spawnParticles(asteroid.x, asteroid.y, 12, particleColor);
                  setScore(s => s + Math.floor(asteroid.size * (asteroid.type === 'armored' ? 2 : 1)));
                  
                  // Clear locked target if this asteroid was locked
                  if (lockedTargetRef.current && lockedTargetRef.current.id === asteroid.id) {
                    lockedTargetRef.current = null;
                    setLockedTarget(null);
                  }
                  
                  // 20% chance to drop power-up
                  if (Math.random() < 0.2) {
                    spawnPowerUp(asteroid.x, asteroid.y);
                  }
                  
                  // Splitting asteroids create smaller ones
                  if (asteroid.type === 'splitting') {
                    spawnSplitAsteroids(asteroid.x, asteroid.y);
                  }
                  
                  updatedAsteroids.splice(j, 1);
                } else {
                  spawnParticles(asteroid.x, asteroid.y, 3);
                }
                
                remainingBullets.splice(i, 1);
                break;
              }
            }
          }
          
          return updatedAsteroids;
        });
        
        return remainingBullets;
      });

      // Check beam-asteroid collisions for all active beams
      beams.forEach(beam => {
        setAsteroids(prevAsteroids => {
          let updatedAsteroids = [...prevAsteroids];
          
          for (let j = updatedAsteroids.length - 1; j >= 0; j--) {
            const asteroid = updatedAsteroids[j];
            
            const dx = beam.targetX - shipPos.x;
            const dy = beam.targetY - shipPos.y;
            const beamLength = Math.sqrt(dx * dx + dy * dy);
            
            if (beamLength === 0) continue;
            
            const ax = asteroid.x - shipPos.x;
            const ay = asteroid.y - shipPos.y;
            
            const projection = (ax * dx + ay * dy) / (beamLength * beamLength);
            
            if (projection >= 0 && projection <= 1) {
              const closestX = shipPos.x + projection * dx;
              const closestY = shipPos.y + projection * dy;
              
              const distTx = asteroid.x - closestX;
              const distTy = asteroid.y - closestY;
              const distToBeam = Math.sqrt(distTx * distTx + distTy * distTy);
              
              // Beam width scales with damage
              // Normal: 10px fixed
              // Spread: 10px to 45px based on damage (11 to 44)
              let beamWidth = 10;
              if (hasPowerUp('spread')) {
                // Scale from 10px (at 11 damage) to 45px (at 44 damage)
                const damageRatio = (beam.damage - 11) / (44 - 11); // 0 to 1
                beamWidth = 10 + (damageRatio * 35); // 10 to 45
              }
              
              if (distToBeam < asteroid.size + beamWidth) {
                asteroid.hp -= beam.damage;
                
                if (asteroid.hp <= 0) {
                  const particleColor = getAsteroidColor(asteroid.type);
                  spawnParticles(asteroid.x, asteroid.y, 12, particleColor);
                  setScore(s => s + Math.floor(asteroid.size * 2 * (asteroid.type === 'armored' ? 2 : 1)));
                  
                  // Clear locked target if this asteroid was locked
                  if (lockedTargetRef.current && lockedTargetRef.current.id === asteroid.id) {
                    lockedTargetRef.current = null;
                    setLockedTarget(null);
                  }
                  
                  if (Math.random() < 0.2) {
                    spawnPowerUp(asteroid.x, asteroid.y);
                  }
                  
                  if (asteroid.type === 'splitting') {
                    spawnSplitAsteroids(asteroid.x, asteroid.y);
                  }
                  
                  updatedAsteroids.splice(j, 1);
                } else {
                  spawnParticles(asteroid.x, asteroid.y, 5);
                }
              }
            }
          }
          
          return updatedAsteroids;
        });
      });

      gameLoopRef.current = requestAnimationFrame(gameLoop);
    };

    const updateLockedTarget = (asteroidList: Asteroid[]) => {
      const cursorX = mousePos.x;
      const cursorY = mousePos.y;
      let closestAsteroid: Asteroid | null = null;
      let closestDistance = Infinity;

      asteroidList.forEach(asteroid => {
        const dx = asteroid.x - cursorX;
        const dy = asteroid.y - cursorY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < 150 && distance < closestDistance) {
          closestDistance = distance;
          closestAsteroid = asteroid;
        }
      });

      lockedTargetRef.current = closestAsteroid;
      setLockedTarget(closestAsteroid);
    };

    gameLoopRef.current = requestAnimationFrame(gameLoop);

    return () => {
      if (gameLoopRef.current) {
        cancelAnimationFrame(gameLoopRef.current);
      }
    };
  }, [gameOver, gameStarted, shipPos, shipVelocity, mousePos, beams, invincible, hasPowerUp, spawnParticles, spawnPowerUp, spawnSplitAsteroids]);

  const startGame = () => {
    setGameStarted(true);
    setGameOver(false);
    setScore(0);
    setLives(3);
    setShields(0);
    setAsteroids([]);
    setBullets([]);
    setParticles([]);
    setPowerUps([]);
    setActivePowerUps([]);
    setShipPos({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    setShipVelocity({ x: 0, y: 0 });
    setLockedTarget(null);
    lockedTargetRef.current = null;
    setBeams([]);
    setIsCharging(false);
    setInvincible(false);
    keysPressed.current.clear();
    mouseDownTime.current = 0;
    lastCollisionTime.current = 0;
    lastShotTime.current = 0;
    nextAsteroidId.current = 0;
    nextBulletId.current = 0;
    nextParticleId.current = 0;
    nextPowerUpId.current = 0;
    nextBeamId.current = 0;
  };

  const resetGame = () => {
    setGameStarted(false);
    setScore(0);
    setLives(3);
    setShields(0);
    setGameOver(false);
    setAsteroids([]);
    setBullets([]);
    setParticles([]);
    setPowerUps([]);
    setActivePowerUps([]);
    setShipPos({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    setShipVelocity({ x: 0, y: 0 });
    setLockedTarget(null);
    lockedTargetRef.current = null;
    setBeams([]);
    setIsCharging(false);
    setInvincible(false);
    keysPressed.current.clear();
    mouseDownTime.current = 0;
    lastCollisionTime.current = 0;
    lastShotTime.current = 0;
    nextAsteroidId.current = 0;
    nextBulletId.current = 0;
    nextParticleId.current = 0;
    nextPowerUpId.current = 0;
    nextBeamId.current = 0;
  };

  // Helper functions
  const getAsteroidColor = (type: Asteroid['type']) => {
    switch(type) {
      case 'fast': return '#00ffff';
      case 'armored': return '#ff8800';
      case 'splitting': return '#ff00ff';
      default: return undefined;
    }
  };

  const getPowerUpColor = (type: PowerUp['type']) => {
    switch(type) {
      case 'shield': return '#00ccff';
      case 'rapidfire': return '#ffff00';
      case 'spread': return '#ff00ff';
      case 'health': return '#00ff00';
    }
  };

  const getPowerUpSymbol = (type: PowerUp['type']) => {
    switch(type) {
      case 'shield': return '🛡';
      case 'rapidfire': return '⚡';
      case 'spread': return '◈';
      case 'health': return '+';
    }
  };

  // Cheat menu toggle
  useEffect(() => {
    const handleCheatKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'c') {
        setShowCheatMenu(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleCheatKey);
    return () => window.removeEventListener('keydown', handleCheatKey);
  }, []);

  // Cheat functions
  const giveAllPowerUps = () => {
    const now = Date.now();
    setActivePowerUps([
      { type: 'rapidfire', endTime: now + 30000, startTime: now },
      { type: 'spread', endTime: now + 30000, startTime: now }
    ]);
    setShields(5);
    setLives(5);
  };

  const clearAsteroids = () => {
    setAsteroids([]);
  };

  const addScore = (amount: number) => {
    setScore(s => s + amount);
  };

  if (!mounted) {
    return null;
  }

  return (
    <div className="w-screen h-screen relative overflow-hidden bg-black" style={{ cursor: 'none' }}>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes flash {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
      `}</style>
      
      {/* Background layer */}
      <div className="absolute top-0 left-0 w-full h-full z-0">
        <PixelSnow 
          color="#ffffff"
          flakeSize={0.01}
          minFlakeSize={1.25}
          pixelResolution={200}
          speed={1.25}
          depthFade={8}
          farPlane={20}
          brightness={0.7}
          gamma={0.4545}
          density={0.3}
          variant="snowflake"
          direction={125}
        />
      </div>

      {/* Game UI */}
      {gameStarted && !gameOver && (
        <>
          <div className="absolute top-5 left-5 z-10 text-white font-mono text-xl" style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.8)' }}>
            <div>Score: {score}</div>
            <div>Lives: {lives}</div>
            {shields > 0 && (
              <div style={{ color: '#00ccff' }}>Shields: {shields}</div>
            )}
          </div>

          {/* Active Power-ups Display */}
          <div className="absolute top-5 right-5 z-10 text-white font-mono text-sm" style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.8)' }}>
            {activePowerUps.filter(p => p.type !== 'shield').map((powerUp, i) => {
              const timeLeft = Math.ceil((powerUp.endTime - Date.now()) / 1000);
              return (
                <div key={i} style={{ 
                  color: getPowerUpColor(powerUp.type as PowerUp['type']),
                  marginBottom: '5px'
                }}>
                  {powerUp.type.toUpperCase()}: {timeLeft}s
                </div>
              );
            })}
          </div>

          {/* Controls */}
          <div className="absolute bottom-5 left-5 z-10 text-white font-mono text-sm opacity-70" style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.8)' }}>
            <div>WASD / Arrow Keys: Move</div>
            <div>Mouse: Aim</div>
            <div style={{ color: '#ffff00' }}>Click: Shoot (2 dmg)</div>
            <div style={{ color: '#00ffff' }}>Hold: Beam (2-10 dmg)</div>
            {hasPowerUp('rapidfire') && (
              <div style={{ color: '#ffff00', marginTop: '5px' }}>RAPID FIRE: Fast shots + 3x yellow beam!</div>
            )}
            {hasPowerUp('spread') && (
              <div style={{ color: '#ff00ff', marginTop: '5px' }}>SPREAD: 3 bullets + wide beam (11-44 dmg)!</div>
            )}
            <div className="mt-2" style={{ color: '#ffaa00' }}>
              <div>Orange Line: Lead Target</div>
              <div>Red Line: Direct Line</div>
            </div>
          </div>

          {/* Locked Target Indicator */}
          {lockedTarget && (
            <div className="absolute top-5 right-5 z-10 text-red-500 font-mono" 
                 style={{ 
                   textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
                   animation: 'pulse 1s infinite',
                   marginTop: activePowerUps.filter(p => p.type !== 'shield').length * 25 + 'px'
                 }}>
              TARGET LOCKED
            </div>
          )}
        </>
      )}

      {/* Start Screen */}
      {!gameStarted && !gameOver && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 text-center text-white font-mono cursor-default">
          <h1 className="text-6xl mb-5" style={{ 
            textShadow: '0 0 20px cyan, 0 0 40px cyan',
            letterSpacing: '5px'
          }}>
            ASTEROID DEFENDER
          </h1>
          <div className="text-lg mb-10 text-gray-400 leading-relaxed">
            <p>WASD / Arrow Keys to Move</p>
            <p>Mouse to Aim</p>
            <p style={{ color: '#ffff00' }}>Click to Shoot (2 damage)</p>
            <p style={{ color: '#00ffff' }}>Hold to Charge Beam (2-10 damage)</p>
            <p className="mt-5" style={{ color: '#ffaa00' }}>
              Lock onto asteroids for guided targeting
            </p>
            <p style={{ color: '#ff6666', fontSize: '14px', marginTop: '10px' }}>
              Watch out for different asteroid types!
            </p>
            <p style={{ color: '#00ff00', fontSize: '14px', marginTop: '10px' }}>
              Power-ups replace beam with special abilities!
            </p>
          </div>
          <button
            onClick={startGame}
            className="px-12 py-5 text-2xl cursor-pointer bg-cyan-400 text-black border-none rounded-lg font-mono font-bold transition-all duration-300"
            style={{ boxShadow: '0 0 20px cyan' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.1)';
              e.currentTarget.style.boxShadow = '0 0 30px cyan';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = '0 0 20px cyan';
            }}
          >
            START GAME
          </button>
          <div className="mt-10 text-sm text-gray-600">
            Survive as long as you can and rack up the highest score!
          </div>
        </div>
      )}

      {/* Game Over Screen */}
      {gameOver && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 text-center text-white font-mono cursor-default">
          <h1 className="text-6xl mb-5 text-red-500" style={{ 
            textShadow: '0 0 20px #ff4444, 0 0 40px #ff4444'
          }}>
            GAME OVER
          </h1>
          <p className="text-3xl mb-2 text-cyan-400" style={{ textShadow: '0 0 10px cyan' }}>
            Final Score: {score}
          </p>
          <p className="text-lg mb-10 text-gray-400">
            {score > 500 ? 'Excellent!' : score > 300 ? 'Great job!' : score > 100 ? 'Good try!' : 'Keep practicing!'}
          </p>
          <button
            onClick={resetGame}
            className="px-12 py-5 text-2xl cursor-pointer bg-white text-black border-none rounded-lg font-mono font-bold transition-all duration-300"
            style={{ boxShadow: '0 0 20px white' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.1)';
              e.currentTarget.style.backgroundColor = 'cyan';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.backgroundColor = 'white';
            }}
          >
            PLAY AGAIN
          </button>
        </div>
      )}

      {/* Cheat Menu */}
      {showCheatMenu && (
        <div className="absolute top-5 right-5 z-30 bg-black bg-opacity-90 border-2 border-cyan-400 rounded-lg p-4 text-white font-mono text-sm cursor-default">
          <div className="text-cyan-400 font-bold mb-3 text-center">CHEAT MENU</div>
          <div className="space-y-2">
            <button
              onClick={() => { setLives(l => Math.min(5, l + 1)); }}
              className="w-full px-3 py-1 bg-green-600 hover:bg-green-700 rounded transition-colors cursor-pointer"
            >
              + Life
            </button>
            <button
              onClick={() => { setShields(s => Math.min(5, s + 1)); }}
              className="w-full px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded transition-colors cursor-pointer"
            >
              + Shield
            </button>
            
            <div className="text-cyan-400 text-xs mt-2 mb-1">Power-ups:</div>
            
            <button
              onClick={() => {
                const now = Date.now();
                setActivePowerUps(prev => [
                  ...prev.filter(p => p.type !== 'rapidfire'),
                  { type: 'rapidfire', endTime: now + 30000, startTime: now }
                ]);
              }}
              className="w-full px-3 py-1 bg-yellow-600 hover:bg-yellow-700 rounded transition-colors cursor-pointer"
            >
              Rapid Fire
            </button>
            
            <button
              onClick={() => {
                const now = Date.now();
                setActivePowerUps(prev => [
                  ...prev.filter(p => p.type !== 'spread'),
                  { type: 'spread', endTime: now + 30000, startTime: now }
                ]);
              }}
              className="w-full px-3 py-1 bg-purple-600 hover:bg-purple-700 rounded transition-colors cursor-pointer"
            >
              Spread Shot
            </button>
            
            <div className="text-cyan-400 text-xs mt-2 mb-1">Game:</div>
            
            <button
              onClick={clearAsteroids}
              className="w-full px-3 py-1 bg-red-600 hover:bg-red-700 rounded transition-colors cursor-pointer"
            >
              Clear Asteroids
            </button>
            <button
              onClick={() => addScore(1000)}
              className="w-full px-3 py-1 bg-yellow-700 hover:bg-yellow-800 rounded transition-colors cursor-pointer"
            >
              +1000 Score
            </button>
            <button
              onClick={() => setInvincible(!invincible)}
              className="w-full px-3 py-1 bg-orange-600 hover:bg-orange-700 rounded transition-colors cursor-pointer"
            >
              {invincible ? 'Invincible: ON' : 'Invincible: OFF'}
            </button>
          </div>
          <div className="text-gray-400 text-xs mt-3 text-center">Press C to close</div>
        </div>
      )}

      {/* Game Objects Layer */}
      {gameStarted && !gameOver && (
        <div className="absolute top-0 left-0 w-full h-full z-[1] pointer-events-none">
          {/* Ship */}
          <div
            className="absolute transition-transform duration-100 ease-out"
            style={{
              left: shipPos.x,
              top: shipPos.y,
              transform: `translate(-50%, -50%) rotate(${Math.atan2(
                mousePos.y - shipPos.y,
                mousePos.x - shipPos.x
              )}rad)`,
              opacity: invincible ? 0.5 : 1,
              animation: invincible ? 'flash 0.2s infinite' : 'none'
            }}
          >
            <svg width="40" height="40" viewBox="0 0 40 40">
              <polygon
                points="30,20 10,10 10,30"
                fill="white"
                stroke={invincible ? "#ff4444" : shields > 0 ? "#00ccff" : "cyan"}
                strokeWidth="2"
              />
              {shields > 0 && (
                <circle cx="20" cy="20" r="18" fill="none" stroke="#00ccff" strokeWidth="2" opacity="0.5">
                  <animate attributeName="r" values="18;22;18" dur="1s" repeatCount="indefinite" />
                </circle>
              )}
            </svg>
            {invincible && (
              <div className="absolute -top-8 left-1/2 -translate-x-1/2 text-red-500 text-xs font-mono font-bold whitespace-nowrap"
                   style={{ textShadow: '0 0 5px #ff4444' }}>
                INVINCIBLE
              </div>
            )}
          </div>

          {/* Asteroids */}
          {asteroids.map(asteroid => {
            const asteroidColor = asteroid.type === 'fast' ? '#00ffff' :
                                 asteroid.type === 'armored' ? '#ff8800' :
                                 asteroid.type === 'splitting' ? '#ff00ff' :
                                 'white';
            
            return (
              <div
                key={asteroid.id}
                className="cursor-target absolute pointer-events-auto"
                style={{
                  left: asteroid.x,
                  top: asteroid.y,
                  width: asteroid.size * 2,
                  height: asteroid.size * 2,
                  transform: `translate(-50%, -50%) rotate(${asteroid.rotation}deg)`
                }}
              >
                <svg width={asteroid.size * 2} height={asteroid.size * 2} viewBox="0 0 100 100">
                  <polygon
                    points="50,5 80,25 85,60 60,90 30,85 10,60 15,25"
                    fill="rgba(100, 100, 100, 0.8)"
                    stroke={asteroidColor}
                    strokeWidth={asteroid.type === 'armored' ? '4' : '2'}
                  />
                </svg>
                
                {/* HP Bar */}
                <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 h-1 bg-red-900 bg-opacity-30 border border-white border-opacity-50 rounded overflow-hidden"
                     style={{
                       width: asteroid.size * 1.5,
                       transform: `translateX(-50%) rotate(${-asteroid.rotation}deg)`
                     }}>
                  <div className="h-full transition-all duration-200"
                       style={{
                         width: `${(asteroid.hp / asteroid.maxHp) * 100}%`,
                         backgroundColor: asteroid.hp > asteroid.maxHp * 0.5 ? '#00ff00' : 
                                        asteroid.hp > asteroid.maxHp * 0.25 ? '#ffff00' : '#ff0000'
                       }} />
                </div>
              </div>
            );
          })}

          {/* Power-ups */}
          {powerUps.map(powerUp => (
            <div
              key={powerUp.id}
              className="absolute"
              style={{
                left: powerUp.x,
                top: powerUp.y,
                transform: 'translate(-50%, -50%)'
              }}
            >
              <div className="relative w-8 h-8 rounded border-2 flex items-center justify-center text-xl font-bold"
                   style={{
                     borderColor: getPowerUpColor(powerUp.type),
                     backgroundColor: `${getPowerUpColor(powerUp.type)}33`,
                     color: getPowerUpColor(powerUp.type),
                     boxShadow: `0 0 10px ${getPowerUpColor(powerUp.type)}`
                   }}>
                {getPowerUpSymbol(powerUp.type)}
              </div>
            </div>
          ))}

          {/* Bullets */}
          {bullets.map(bullet => (
            <div
              key={bullet.id}
              className="absolute w-1.5 h-1.5 rounded-full bg-yellow-400"
              style={{
                left: bullet.x,
                top: bullet.y,
                transform: 'translate(-50%, -50%)',
                boxShadow: '0 0 10px yellow'
              }}
            />
          ))}

          {/* Particles */}
          {particles.map(particle => (
            <div
              key={particle.id}
              className="absolute rounded-full"
              style={{
                left: particle.x,
                top: particle.y,
                width: particle.size,
                height: particle.size,
                backgroundColor: particle.color || `rgba(255, ${255 * particle.life}, 0, ${particle.life})`,
                transform: 'translate(-50%, -50%)',
                boxShadow: `0 0 ${particle.size * 2}px ${particle.color || `rgba(255, ${255 * particle.life}, 0, ${particle.life})`}`
              }}
            />
          ))}

          {/* Beam Weapons */}
          {(beams.length > 0 || isCharging) && (
            <svg className="absolute top-0 left-0 w-full h-full pointer-events-none">
              {/* Render all active beams */}
              {beams.map(beam => {
                // Calculate width based on damage for spread shot
                let outerWidth, innerWidth;
                
                if (hasPowerUp('spread')) {
                  // Scale from narrow (at 11 dmg) to wide (at 44 dmg)
                  const damageRatio = Math.min(1, (beam.damage - 11) / (44 - 11));
                  outerWidth = 10 + (damageRatio * 40); // 10 to 50
                  innerWidth = 5 + (damageRatio * 20); // 5 to 25
                } else if (hasPowerUp('rapidfire')) {
                  outerWidth = Math.min(20, 5 + beam.damage * 1.5);
                  innerWidth = Math.min(10, 2 + beam.damage * 0.8);
                } else {
                  // Normal beam
                  outerWidth = Math.min(20, 5 + beam.damage * 1.5);
                  innerWidth = Math.min(10, 2 + beam.damage * 0.8);
                }
                
                return (
                  <g key={beam.id}>
                    <line
                      x1={shipPos.x}
                      y1={shipPos.y}
                      x2={beam.targetX}
                      y2={beam.targetY}
                      stroke={hasPowerUp('rapidfire') ? '#ffff00' : hasPowerUp('spread') ? '#ff00ff' : 'cyan'}
                      strokeWidth={outerWidth}
                      opacity="0.8"
                      strokeLinecap="round"
                      filter="url(#glow)"
                    />
                    <line
                      x1={shipPos.x}
                      y1={shipPos.y}
                      x2={beam.targetX}
                      y2={beam.targetY}
                      stroke="white"
                      strokeWidth={innerWidth}
                      opacity="1"
                      strokeLinecap="round"
                    />
                  </g>
                );
              })}
              
              {/* Charging indicator */}
              {isCharging && (
                <line
                  x1={shipPos.x}
                  y1={shipPos.y}
                  x2={mousePos.x}
                  y2={mousePos.y}
                  stroke={hasPowerUp('rapidfire') ? '#ffff00' : hasPowerUp('spread') ? '#ff00ff' : '#00ffff'}
                  strokeWidth="2"
                  opacity="0.5"
                  strokeDasharray="5,5"
                >
                  <animate
                    attributeName="stroke-dashoffset"
                    values="0;10"
                    dur="0.3s"
                    repeatCount="indefinite"
                  />
                </line>
              )}
              
              <defs>
                <filter id="glow">
                  <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                  <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                  </feMerge>
                </filter>
              </defs>
            </svg>
          )}

          {/* Debug Info */}
          {hasPowerUp('spread') && (
            <div className="absolute top-20 left-5 z-10 text-white font-mono text-xs bg-black bg-opacity-50 p-2 rounded">
              Last beam damage: {beams.length > 0 ? beams[beams.length - 1].damage.toFixed(1) : 'N/A'}
            </div>
          )}

          {/* Charge Indicator */}
          {isCharging && (
            <div className="absolute pointer-events-none"
                 style={{
                   left: shipPos.x,
                   top: shipPos.y - 40,
                   transform: 'translateX(-50%)'
                 }}>
              <div className="w-15 h-2 bg-black bg-opacity-50 rounded overflow-hidden"
                   style={{
                     border: `1px solid ${hasPowerUp('rapidfire') ? '#ffff00' : hasPowerUp('spread') ? '#ff00ff' : 'cyan'}`
                   }}>
                <div className="h-full transition-all duration-50"
                     style={{
                       width: `${Math.min(100, ((Date.now() - mouseDownTime.current) / (hasPowerUp('rapidfire') ? 500 : hasPowerUp('spread') ? 4000 : 1000)) * 100)}%`,
                       backgroundColor: hasPowerUp('rapidfire') ? '#ffff00' : hasPowerUp('spread') ? '#ff00ff' : 'cyan',
                       boxShadow: `0 0 10px ${hasPowerUp('rapidfire') ? '#ffff00' : hasPowerUp('spread') ? '#ff00ff' : 'cyan'}`
                     }} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Crosshair and Cursor */}
      <div className="relative z-[2] w-full h-full pointer-events-none">
        {gameStarted && <Crosshair color="cyan" />}
        {gameStarted && <TargetCursor targetSelector=".cursor-target" spinDuration={0.5} />}
        
        {/* Target Lock Indicator */}
        {lockedTarget && gameStarted && (
          <>
            <svg className="absolute top-0 left-0 w-full h-full pointer-events-none">
              <line
                x1={shipPos.x}
                y1={shipPos.y}
                x2={lockedTarget.x}
                y2={lockedTarget.y}
                stroke="#ff4444"
                strokeWidth="2"
                strokeDasharray="10,5"
                opacity="0.4"
              />
              
              <line
                x1={shipPos.x}
                y1={shipPos.y}
                x2={lockedTarget.x + lockedTarget.speedX * 30}
                y2={lockedTarget.y + lockedTarget.speedY * 30}
                stroke="#ffaa00"
                strokeWidth="2"
                strokeDasharray="5,5"
                opacity="0.6"
              >
                <animate
                  attributeName="stroke-dashoffset"
                  values="0;10"
                  dur="0.5s"
                  repeatCount="indefinite"
                />
              </line>
              
              <circle
                cx={lockedTarget.x + lockedTarget.speedX * 30}
                cy={lockedTarget.y + lockedTarget.speedY * 30}
                r="8"
                fill="none"
                stroke="#ffaa00"
                strokeWidth="2"
                opacity="0.8"
              >
                <animate
                  attributeName="r"
                  values="6;10;6"
                  dur="1s"
                  repeatCount="indefinite"
                />
              </circle>
            </svg>
            
            <div className="absolute pointer-events-none"
                 style={{
                   left: lockedTarget.x,
                   top: lockedTarget.y,
                   transform: 'translate(-50%, -50%)'
                 }}>
              <svg width="80" height="80" viewBox="0 0 80 80" style={{ filter: 'drop-shadow(0 0 5px #ff4444)' }}>
                <circle
                  cx="40"
                  cy="40"
                  r="35"
                  fill="none"
                  stroke="#ff4444"
                  strokeWidth="2"
                  strokeDasharray="5,5"
                  opacity="0.8"
                >
                  <animateTransform
                    attributeName="transform"
                    type="rotate"
                    from="0 40 40"
                    to="360 40 40"
                    dur="2s"
                    repeatCount="indefinite"
                  />
                </circle>
                
                <path d="M 15 15 L 15 25 M 15 15 L 25 15" stroke="#ff4444" strokeWidth="3" opacity="0.9" />
                <path d="M 65 15 L 65 25 M 65 15 L 55 15" stroke="#ff4444" strokeWidth="3" opacity="0.9" />
                <path d="M 15 65 L 15 55 M 15 65 L 25 65" stroke="#ff4444" strokeWidth="3" opacity="0.9" />
                <path d="M 65 65 L 65 55 M 65 65 L 55 65" stroke="#ff4444" strokeWidth="3" opacity="0.9" />
                
                <circle cx="40" cy="40" r="3" fill="#ff4444" opacity="0.8">
                  <animate
                    attributeName="opacity"
                    values="0.4;1;0.4"
                    dur="1s"
                    repeatCount="indefinite"
                  />
                </circle>
              </svg>
            </div>
          </>
        )}
      </div>
    </div>
  );
}