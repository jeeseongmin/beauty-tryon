"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface UseCameraOptions {
  facingMode?: "user" | "environment";
  width?: number;
  height?: number;
}

export function useCamera(options: UseCameraOptions = {}) {
  const { facingMode = "user", width = 640, height = 480 } = options;
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          width: { ideal: width },
          height: { ideal: height },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setIsReady(true);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "카메라에 접근할 수 없습니다."
      );
    }
  }, [facingMode, width, height]);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setIsReady(false);
  }, []);

  const captureFrame = useCallback((): ImageData | null => {
    const video = videoRef.current;
    if (!video || !isReady) return null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }, [isReady]);

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return { videoRef, isReady, error, start, stop, captureFrame };
}
