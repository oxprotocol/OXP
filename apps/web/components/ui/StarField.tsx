"use client";

import React, { useEffect, useRef } from "react";

export function StarField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    let stars: { x: number; y: number; z: number; prevZ: number }[] = [];
    const STAR_COUNT = 180;
    const SPEED = 0.15;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    const initStars = () => {
      stars = [];
      for (let i = 0; i < STAR_COUNT; i++) {
        stars.push({
          x: Math.random() * canvas.width - canvas.width / 2,
          y: Math.random() * canvas.height - canvas.height / 2,
          z: Math.random() * canvas.width,
          prevZ: 0,
        });
      }
    };

    const draw = () => {
      ctx.fillStyle = "rgba(6, 10, 19, 0.12)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const cx = canvas.width / 2;
      const cy = canvas.height / 2;

      for (const star of stars) {
        star.prevZ = star.z;
        star.z -= SPEED;

        if (star.z <= 0) {
          star.x = Math.random() * canvas.width - cx;
          star.y = Math.random() * canvas.height - cy;
          star.z = canvas.width;
          star.prevZ = star.z;
        }

        const sx = (star.x / star.z) * canvas.width * 0.5 + cx;
        const sy = (star.y / star.z) * canvas.height * 0.5 + cy;

        const r = Math.max(0, (1 - star.z / canvas.width) * 1.4);
        const brightness = Math.max(0, 1 - star.z / canvas.width);

        // Mostly white with occasional subtle gold tint
        const gold = Math.random() > 0.85;
        if (gold) {
          ctx.fillStyle = `rgba(125, 211, 252, ${brightness * 0.3})`;
        } else {
          ctx.fillStyle = `rgba(248, 250, 252, ${brightness * 0.5})`;
        }

        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();
      }

      animationId = requestAnimationFrame(draw);
    };

    resize();
    initStars();
    draw();

    const handleResize = () => {
      resize();
      initStars();
    };

    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      data-starfield
      className="fixed inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 0 }}
    />
  );
}
