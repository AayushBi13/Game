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
}

interface BeamWeapon {
  active: boolean;
  startTime: number;
  targetX: number;
  targetY: number;
  damage: number;
}

export default function AsteroidShooter() {
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [gameOver, setGameOver] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [asteroids, setAsteroids] = useState<Asteroid[]>([]);
  const [bullets, setBullets] = useState<Bullet[]>([]);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [shipPos, setShipPos] = useState({ x: 0, y: 0 });
  const [shipVelocity, setShipVelocity] = useState({ x: 0, y: 0 });
  const [lockedTarget, setLockedTarget] = useState<Asteroid | null>(null);
  const [mounted, setMounted] = useState(false);
  const [beam, setBeam] = useState<BeamWeapon>({ active: false, startTime: 0, targetX: 0, targetY: 0, damage: 0 });
  const [isCharging, setIsCharging] = useState(false);
  const [invincible, setInvincible] = useState(false);
  const keysPressed = useRef<Set<string>>(new Set());
  const mouseDownTime = useRef<number>(0);
  const beamInterval = useRef<number>(0);
  const lastCollisionTime = useRef<number>(0);
  
  const nextAsteroidId = useRef(0);
  const nextBulletId = useRef(0);
  const nextParticleId = useRef(0);
  const gameLoopRef = useRef<number>(0);

  // Initialize after mount to avoid SSR issues
  useEffect(() => {
    setMounted(true);
    setShipPos({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  }, []);

  // Spawn asteroids
  const spawnAsteroid = useCallback(() => {
    const side = Math.floor(Math.random() * 4);
    let x, y, speedX, speedY;
    
    const speed = 0.3 + Math.random() * 0.5; // Reduced from 1 + Math.random() * 2
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

    const newAsteroid: Asteroid = {
      id: nextAsteroidId.current++,
      x,
      y,
      size: 30 + Math.random() * 40,
      speedX,
      speedY,
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 2,
      hp: 0,
      maxHp: 0
    };

    // Assign HP based on size
    if (newAsteroid.size >= 60) {
      newAsteroid.maxHp = 8;
    } else if (newAsteroid.size >= 50) {
      newAsteroid.maxHp = 5;
    } else if (newAsteroid.size >= 40) {
      newAsteroid.maxHp = 3;
    } else {
      newAsteroid.maxHp = 2;
    }
    newAsteroid.hp = newAsteroid.maxHp;

    setAsteroids(prev => [...prev, newAsteroid]);
  }, []);

  // Spawn particles for explosion effect
  const spawnParticles = useCallback((x: number, y: number, count: number = 8) => {
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
        size: 3 + Math.random() * 3
      });
    }
    setParticles(prev => [...prev, ...newParticles]);
  }, []);

  // Shoot bullet (quick tap)
  const shootBullet = useCallback((mouseX: number, mouseY: number) => {
    if (gameOver || !gameStarted) return;

    const dx = mouseX - shipPos.x;
    const dy = mouseY - shipPos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const speed = 6;

    const newBullet: Bullet = {
      id: nextBulletId.current++,
      x: shipPos.x,
      y: shipPos.y,
      velocityX: (dx / distance) * speed,
      velocityY: (dy / distance) * speed
    };

    setBullets(prev => [...prev, newBullet]);
  }, [gameOver, gameStarted, shipPos]);

  // Handle mouse down - start charging
  const handleMouseDown = useCallback((e: MouseEvent) => {
    if (gameOver || !gameStarted) return;
    
    mouseDownTime.current = Date.now();
    setIsCharging(true);
    
    setBeam({
      active: false,
      startTime: Date.now(),
      targetX: e.clientX,
      targetY: e.clientY,
      damage: 0
    });
  }, [gameOver, gameStarted]);

  // Handle mouse up - fire beam or bullet
  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (gameOver || !gameStarted) return;
    
    const holdDuration = (Date.now() - mouseDownTime.current) / 1000; // in seconds
    setIsCharging(false);
    
    if (holdDuration < 0.1) {
      // Quick tap - shoot normal bullet
      shootBullet(e.clientX, e.clientY);
    } else {
      // Charged shot - fire beam
      const damage = Math.min(10, 2 + (holdDuration * 10)); // 2 damage at 0.1s, 10 damage at 1s+
      
      setBeam({
        active: true,
        startTime: Date.now(),
        targetX: e.clientX,
        targetY: e.clientY,
        damage: damage
      });
      
      // Beam lasts for 200ms
      setTimeout(() => {
        setBeam(prev => ({ ...prev, active: false }));
      }, 200);
    }
    
    mouseDownTime.current = 0;
  }, [gameOver, gameStarted, shootBullet]);

  // Track mouse position and keyboard
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
      
      // Update beam target while charging
      if (isCharging) {
        setBeam(prev => ({
          ...prev,
          targetX: e.clientX,
          targetY: e.clientY
        }));
      }
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
    }, 3000); // Increased from 2000 to slow spawn rate

    // Spawn initial asteroids
    for (let i = 0; i < 3; i++) {
      setTimeout(() => spawnAsteroid(), i * 800); // Increased spacing
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
        const acceleration = 0.3; // Reduced from 0.5
        const maxSpeed = 3; // Reduced from 5
        const friction = 0.92;

        // Apply acceleration based on keys
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

        // Apply friction
        newVelX *= friction;
        newVelY *= friction;

        // Cap speed
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

      // Update asteroids
      setAsteroids(prev => {
        const updated = prev.map(asteroid => ({
          ...asteroid,
          x: asteroid.x + asteroid.speedX,
          y: asteroid.y + asteroid.speedY,
          rotation: asteroid.rotation + asteroid.rotationSpeed
        })).filter(asteroid => {
          // Remove off-screen asteroids
          return asteroid.x > -100 && asteroid.x < window.innerWidth + 100 &&
                 asteroid.y > -100 && asteroid.y < window.innerHeight + 100;
        });

        // Check collision with ship (only if not invincible)
        if (!invincible) {
          const currentTime = Date.now();
          const cooldownPeriod = 2000; // 2 seconds
          
          const remainingAsteroids = updated.filter(asteroid => {
            const dx = asteroid.x - shipPos.x;
            const dy = asteroid.y - shipPos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < asteroid.size + 20) {
              // Check if we're still in cooldown period
              if (currentTime - lastCollisionTime.current >= cooldownPeriod) {
                // Collision detected and cooldown expired
                lastCollisionTime.current = currentTime;
                
                setLives(l => {
                  const newLives = l - 1;
                  if (newLives <= 0) {
                    setGameOver(true);
                  }
                  return newLives;
                });
                
                // Set invincibility for 2 seconds
                setInvincible(true);
                setTimeout(() => setInvincible(false), cooldownPeriod);
                
                spawnParticles(asteroid.x, asteroid.y, 12);
              }
              return false; // Always remove the colliding asteroid
            }
            return true; // Keep this asteroid
          });
          
          // Update locked target - find closest asteroid to cursor
          const cursorX = mousePos.x;
          const cursorY = mousePos.y;
          let closestAsteroid: Asteroid | null = null;
          let closestDistance = Infinity;

          remainingAsteroids.forEach(asteroid => {
            const dx = asteroid.x - cursorX;
            const dy = asteroid.y - cursorY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            // Lock on if within reasonable range
            if (distance < 150 && distance < closestDistance) {
              closestDistance = distance;
              closestAsteroid = asteroid;
            }
          });

          setLockedTarget(closestAsteroid);

          return remainingAsteroids;
        } else {
          // Still update locked target even when invincible
          const cursorX = mousePos.x;
          const cursorY = mousePos.y;
          let closestAsteroid: Asteroid | null = null;
          let closestDistance = Infinity;

          updated.forEach(asteroid => {
            const dx = asteroid.x - cursorX;
            const dy = asteroid.y - cursorY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < 150 && distance < closestDistance) {
              closestDistance = distance;
              closestAsteroid = asteroid;
            }
          });

          setLockedTarget(closestAsteroid);

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
                // Hit! Bullet does 2 damage
                asteroid.hp -= 2;
                
                if (asteroid.hp <= 0) {
                  // Asteroid destroyed
                  spawnParticles(asteroid.x, asteroid.y);
                  setScore(s => s + Math.floor(asteroid.size));
                  updatedAsteroids.splice(j, 1);
                } else {
                  // Just damaged, spawn smaller particles
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

      // Check beam-asteroid collisions
      if (beam.active) {
        setAsteroids(prevAsteroids => {
          let updatedAsteroids = [...prevAsteroids];
          
          // Check which asteroids are hit by the beam
          for (let j = updatedAsteroids.length - 1; j >= 0; j--) {
            const asteroid = updatedAsteroids[j];
            
            // Calculate distance from beam line to asteroid center
            const dx = beam.targetX - shipPos.x;
            const dy = beam.targetY - shipPos.y;
            const beamLength = Math.sqrt(dx * dx + dy * dy);
            
            if (beamLength === 0) continue;
            
            // Vector from ship to asteroid
            const ax = asteroid.x - shipPos.x;
            const ay = asteroid.y - shipPos.y;
            
            // Project asteroid onto beam line
            const projection = (ax * dx + ay * dy) / (beamLength * beamLength);
            
            if (projection >= 0 && projection <= 1) {
              // Point on beam closest to asteroid
              const closestX = shipPos.x + projection * dx;
              const closestY = shipPos.y + projection * dy;
              
              // Distance from asteroid to beam
              const distTx = asteroid.x - closestX;
              const distTy = asteroid.y - closestY;
              const distToBeam = Math.sqrt(distTx * distTx + distTy * distTy);
              
              // Beam has width of 10 pixels
              if (distToBeam < asteroid.size + 10) {
                // Hit by beam!
                asteroid.hp -= beam.damage;
                
                if (asteroid.hp <= 0) {
                  // Asteroid destroyed
                  spawnParticles(asteroid.x, asteroid.y, 12);
                  setScore(s => s + Math.floor(asteroid.size * 2)); // Double points for beam kills
                  updatedAsteroids.splice(j, 1);
                } else {
                  // Just damaged
                  spawnParticles(asteroid.x, asteroid.y, 5);
                }
              }
            }
          }
          
          return updatedAsteroids;
        });
      }

      gameLoopRef.current = requestAnimationFrame(gameLoop);
    };

    gameLoopRef.current = requestAnimationFrame(gameLoop);

    return () => {
      if (gameLoopRef.current) {
        cancelAnimationFrame(gameLoopRef.current);
      }
    };
  }, [gameOver, gameStarted, shipPos, shipVelocity, mousePos, beam, invincible, spawnParticles]);

  const startGame = () => {
    setGameStarted(true);
    setGameOver(false);
    setScore(0);
    setLives(3);
    setAsteroids([]);
    setBullets([]);
    setParticles([]);
    setShipPos({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    setShipVelocity({ x: 0, y: 0 });
    setLockedTarget(null);
    setBeam({ active: false, startTime: 0, targetX: 0, targetY: 0, damage: 0 });
    setIsCharging(false);
    setInvincible(false);
    keysPressed.current.clear();
    mouseDownTime.current = 0;
    lastCollisionTime.current = 0;
    nextAsteroidId.current = 0;
    nextBulletId.current = 0;
    nextParticleId.current = 0;
  };

  const resetGame = () => {
    setGameStarted(false);
    setScore(0);
    setLives(3);
    setGameOver(false);
    setAsteroids([]);
    setBullets([]);
    setParticles([]);
    setShipPos({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    setShipVelocity({ x: 0, y: 0 });
    setLockedTarget(null);
    setBeam({ active: false, startTime: 0, targetX: 0, targetY: 0, damage: 0 });
    setIsCharging(false);
    setInvincible(false);
    keysPressed.current.clear();
    mouseDownTime.current = 0;
    lastCollisionTime.current = 0;
    nextAsteroidId.current = 0;
    nextBulletId.current = 0;
    nextParticleId.current = 0;
  };

  if (!mounted) {
    return null; // Don't render until mounted to avoid SSR issues
  }

  return (
    <div style={{ 
      width: '100vw', 
      height: '100vh', 
      position: 'relative',
      overflow: 'hidden',
      backgroundColor: '#000',
      cursor: 'none'
    }}>
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
      {/* Background layer - Changed to PixelSnow */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 0
      }}>
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
          <div style={{
            position: 'absolute',
            top: 20,
            left: 20,
            zIndex: 10,
            color: 'white',
            fontFamily: 'monospace',
            fontSize: '20px',
            textShadow: '2px 2px 4px rgba(0,0,0,0.8)'
          }}>
            <div>Score: {score}</div>
            <div>Lives: {'❤️'.repeat(lives)}</div>
          </div>

          {/* Controls */}
          <div style={{
            position: 'absolute',
            bottom: 20,
            left: 20,
            zIndex: 10,
            color: 'white',
            fontFamily: 'monospace',
            fontSize: '14px',
            textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
            opacity: 0.7
          }}>
            <div>WASD / Arrow Keys: Move</div>
            <div>Mouse: Aim</div>
            <div style={{ color: '#ffff00' }}>Click: Shoot (2 dmg)</div>
            <div style={{ color: '#00ffff' }}>Hold: Beam (2-10 dmg)</div>
            <div style={{ marginTop: '10px', color: '#ffaa00' }}>
              <div>🎯 Orange Line: Lead Target</div>
              <div>🔴 Red Line: Direct Line</div>
            </div>
          </div>

          {/* Locked Target Indicator */}
          {lockedTarget && (
            <div style={{
              position: 'absolute',
              top: 20,
              right: 20,
              zIndex: 10,
              color: '#ff4444',
              fontFamily: 'monospace',
              fontSize: '16px',
              textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
              animation: 'pulse 1s infinite'
            }}>
              🎯 TARGET LOCKED
            </div>
          )}
        </>
      )}

      {/* Start Screen */}
      {!gameStarted && !gameOver && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 20,
          textAlign: 'center',
          color: 'white',
          fontFamily: 'monospace',
          cursor: 'default'
        }}>
          <h1 style={{ 
            fontSize: '64px', 
            marginBottom: '20px',
            textShadow: '0 0 20px cyan, 0 0 40px cyan',
            letterSpacing: '5px'
          }}>
            ASTEROID DEFENDER
          </h1>
          <div style={{
            fontSize: '18px',
            marginBottom: '40px',
            color: '#aaa',
            lineHeight: '1.8'
          }}>
            <p>🎮 WASD / Arrow Keys to Move</p>
            <p>🖱️ Mouse to Aim</p>
            <p style={{ color: '#ffff00' }}>🔫 Click to Shoot (2 damage)</p>
            <p style={{ color: '#00ffff' }}>⚡ Hold to Charge Beam (2-10 damage)</p>
            <p style={{ marginTop: '20px', color: '#ffaa00' }}>
              🎯 Lock onto asteroids for guided targeting
            </p>
            <p style={{ color: '#ff6666', fontSize: '14px', marginTop: '10px' }}>
              ⚠️ Bigger asteroids have more HP!
            </p>
          </div>
          <button
            onClick={startGame}
            style={{
              padding: '20px 50px',
              fontSize: '24px',
              cursor: 'pointer',
              backgroundColor: 'cyan',
              color: 'black',
              border: 'none',
              borderRadius: '10px',
              fontFamily: 'monospace',
              fontWeight: 'bold',
              boxShadow: '0 0 20px cyan',
              transition: 'all 0.3s ease'
            }}
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
          <div style={{
            marginTop: '40px',
            fontSize: '14px',
            color: '#666'
          }}>
            Survive as long as you can and rack up the highest score!
          </div>
        </div>
      )}

      {/* Game Over Screen */}
      {gameOver && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 20,
          textAlign: 'center',
          color: 'white',
          fontFamily: 'monospace',
          cursor: 'default'
        }}>
          <h1 style={{ 
            fontSize: '64px', 
            marginBottom: '20px',
            color: '#ff4444',
            textShadow: '0 0 20px #ff4444, 0 0 40px #ff4444'
          }}>
            GAME OVER
          </h1>
          <p style={{ 
            fontSize: '32px', 
            marginBottom: '10px',
            color: 'cyan',
            textShadow: '0 0 10px cyan'
          }}>
            Final Score: {score}
          </p>
          <p style={{ fontSize: '18px', marginBottom: '40px', color: '#aaa' }}>
            {score > 500 ? '🏆 Excellent!' : score > 300 ? '⭐ Great job!' : score > 100 ? '👍 Good try!' : '💪 Keep practicing!'}
          </p>
          <button
            onClick={resetGame}
            style={{
              padding: '20px 50px',
              fontSize: '24px',
              cursor: 'pointer',
              backgroundColor: '#fff',
              color: 'black',
              border: 'none',
              borderRadius: '10px',
              fontFamily: 'monospace',
              fontWeight: 'bold',
              boxShadow: '0 0 20px white',
              transition: 'all 0.3s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.1)';
              e.currentTarget.style.backgroundColor = 'cyan';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.backgroundColor = '#fff';
            }}
          >
            PLAY AGAIN
          </button>
        </div>
      )}

      {/* Game Objects Layer - Only render when game is active */}
      {gameStarted && !gameOver && (
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 1,
        pointerEvents: 'none'
      }}>
        {/* Ship */}
        <div
          style={{
            position: 'absolute',
            left: shipPos.x,
            top: shipPos.y,
            transform: `translate(-50%, -50%) rotate(${Math.atan2(
              mousePos.y - shipPos.y,
              mousePos.x - shipPos.x
            )}rad)`,
            transition: 'transform 0.1s ease-out',
            opacity: invincible ? 0.5 : 1,
            animation: invincible ? 'flash 0.2s infinite' : 'none'
          }}
        >
          <svg width="40" height="40" viewBox="0 0 40 40">
            <polygon
              points="30,20 10,10 10,30"
              fill="white"
              stroke={invincible ? "#ff4444" : "cyan"}
              strokeWidth="2"
            />
          </svg>
          {invincible && (
            <div style={{
              position: 'absolute',
              top: -30,
              left: '50%',
              transform: 'translateX(-50%)',
              color: '#ff4444',
              fontSize: '12px',
              fontFamily: 'monospace',
              fontWeight: 'bold',
              textShadow: '0 0 5px #ff4444',
              whiteSpace: 'nowrap'
            }}>
              INVINCIBLE
            </div>
          )}
        </div>

        {/* Asteroids */}
        {asteroids.map(asteroid => (
          <div
            key={asteroid.id}
            className="cursor-target"
            style={{
              position: 'absolute',
              left: asteroid.x,
              top: asteroid.y,
              width: asteroid.size * 2,
              height: asteroid.size * 2,
              transform: `translate(-50%, -50%) rotate(${asteroid.rotation}deg)`,
              pointerEvents: 'auto'
            }}
          >
            <svg width={asteroid.size * 2} height={asteroid.size * 2} viewBox="0 0 100 100">
              <polygon
                points="50,5 80,25 85,60 60,90 30,85 10,60 15,25"
                fill="rgba(100, 100, 100, 0.8)"
                stroke="white"
                strokeWidth="2"
              />
            </svg>
            
            {/* HP Bar */}
            <div style={{
              position: 'absolute',
              bottom: -10,
              left: '50%',
              transform: 'translateX(-50%) rotate(' + (-asteroid.rotation) + 'deg)',
              width: asteroid.size * 1.5,
              height: 4,
              backgroundColor: 'rgba(255, 0, 0, 0.3)',
              border: '1px solid rgba(255, 255, 255, 0.5)',
              borderRadius: 2,
              overflow: 'hidden'
            }}>
              <div style={{
                width: `${(asteroid.hp / asteroid.maxHp) * 100}%`,
                height: '100%',
                backgroundColor: asteroid.hp > asteroid.maxHp * 0.5 ? '#00ff00' : asteroid.hp > asteroid.maxHp * 0.25 ? '#ffff00' : '#ff0000',
                transition: 'width 0.2s, background-color 0.2s'
              }} />
            </div>
          </div>
        ))}

        {/* Bullets */}
        {bullets.map(bullet => (
          <div
            key={bullet.id}
            style={{
              position: 'absolute',
              left: bullet.x,
              top: bullet.y,
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: 'yellow',
              transform: 'translate(-50%, -50%)',
              boxShadow: '0 0 10px yellow'
            }}
          />
        ))}

        {/* Particles */}
        {particles.map(particle => (
          <div
            key={particle.id}
            style={{
              position: 'absolute',
              left: particle.x,
              top: particle.y,
              width: particle.size,
              height: particle.size,
              borderRadius: '50%',
              backgroundColor: `rgba(255, ${255 * particle.life}, 0, ${particle.life})`,
              transform: 'translate(-50%, -50%)',
              boxShadow: `0 0 ${particle.size * 2}px rgba(255, ${255 * particle.life}, 0, ${particle.life})`
            }}
          />
        ))}

        {/* Beam Weapon */}
        {(beam.active || isCharging) && (
          <svg
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none'
            }}
          >
            {beam.active ? (
              // Active beam
              <>
                <line
                  x1={shipPos.x}
                  y1={shipPos.y}
                  x2={beam.targetX}
                  y2={beam.targetY}
                  stroke="cyan"
                  strokeWidth={Math.min(20, 5 + beam.damage * 1.5)}
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
                  strokeWidth={Math.min(10, 2 + beam.damage * 0.8)}
                  opacity="1"
                  strokeLinecap="round"
                />
                <defs>
                  <filter id="glow">
                    <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                    <feMerge>
                      <feMergeNode in="coloredBlur"/>
                      <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                  </filter>
                </defs>
              </>
            ) : (
              // Charging indicator
              <line
                x1={shipPos.x}
                y1={shipPos.y}
                x2={beam.targetX}
                y2={beam.targetY}
                stroke="#00ffff"
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
          </svg>
        )}

        {/* Charge Indicator on Ship */}
        {isCharging && (
          <div style={{
            position: 'absolute',
            left: shipPos.x,
            top: shipPos.y - 40,
            transform: 'translateX(-50%)',
            pointerEvents: 'none'
          }}>
            <div style={{
              width: 60,
              height: 8,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              border: '1px solid cyan',
              borderRadius: 4,
              overflow: 'hidden'
            }}>
              <div style={{
                width: `${Math.min(100, ((Date.now() - mouseDownTime.current) / 1000) * 100)}%`,
                height: '100%',
                backgroundColor: 'cyan',
                transition: 'width 0.05s linear',
                boxShadow: '0 0 10px cyan'
              }} />
            </div>
          </div>
        )}
      </div>
      )}

      {/* Crosshair and Cursor */}
      <div style={{
        position: 'relative',
        zIndex: 2,
        width: '100%',
        height: '100%',
        pointerEvents: 'none'
      }}>
        {gameStarted && <Crosshair color="cyan" />}
        {gameStarted && <TargetCursor targetSelector=".cursor-target" spinDuration={0.5} />}
        
        {/* Follow-on Crosshair for Locked Target */}
        {lockedTarget && gameStarted && (
          <>
            {/* Shot Guidance Line */}
            <svg
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none'
              }}
            >
              {/* Line from ship to locked target */}
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
              
              {/* Predicted trajectory line (lead indicator) */}
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
              
              {/* Lead indicator point */}
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
            
            <div style={{
              position: 'absolute',
              left: lockedTarget.x,
              top: lockedTarget.y,
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'none'
            }}>
              {/* Outer ring */}
              <svg width="80" height="80" viewBox="0 0 80 80" style={{
                filter: 'drop-shadow(0 0 5px #ff4444)'
              }}>
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
                
                {/* Corner brackets */}
                <path d="M 15 15 L 15 25 M 15 15 L 25 15" stroke="#ff4444" strokeWidth="3" opacity="0.9" />
                <path d="M 65 15 L 65 25 M 65 15 L 55 15" stroke="#ff4444" strokeWidth="3" opacity="0.9" />
                <path d="M 15 65 L 15 55 M 15 65 L 25 65" stroke="#ff4444" strokeWidth="3" opacity="0.9" />
                <path d="M 65 65 L 65 55 M 65 65 L 55 65" stroke="#ff4444" strokeWidth="3" opacity="0.9" />
                
                {/* Center dot */}
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