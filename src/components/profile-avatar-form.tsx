"use client";

import { useEffect, useRef, useState } from "react";
import NextImage from "next/image";
import Link from "next/link";

const OUTPUT_SIZE = 512;

type ProfileDetails = {
  name: string;
  username: string | null;
  email: string;
  emailVerified: boolean;
  platformRole: "USER" | "ADMIN";
  createdAt: string;
};

export function ProfileAvatarForm({
  profile,
  initialPicture,
  storageEnabled,
  returnTo,
}: {
  profile: ProfileDetails;
  initialPicture: string | null;
  storageEnabled: boolean;
  returnTo?: string;
}) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [picture, setPicture] = useState(initialPicture);
  const [zoom, setZoom] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  function draw() {
    const image = imageRef.current;
    const canvas = canvasRef.current;
    if (!image || !canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const baseScale = Math.max(OUTPUT_SIZE / image.naturalWidth, OUTPUT_SIZE / image.naturalHeight);
    const scale = baseScale * zoom;
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    const overflowX = Math.max(0, width - OUTPUT_SIZE);
    const overflowY = Math.max(0, height - OUTPUT_SIZE);
    const x = -overflowX / 2 + (offsetX / 100) * (overflowX / 2);
    const y = -overflowY / 2 + (offsetY / 100) * (overflowY / 2);
    context.clearRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    context.drawImage(image, x, y, width, height);
  }

  useEffect(draw, [zoom, offsetX, offsetY, ready]);
  useEffect(() => () => { if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current); }, []);

  function selectFile(file?: File) {
    setError(undefined);
    setMessage(undefined);
    if (!file) return;
    if (file.size > 8 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("请选择小于 8 MiB 的 JPEG、PNG 或 WebP 图片。");
      return;
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    const image = new window.Image();
    image.onload = () => {
      imageRef.current = image;
      setZoom(1);
      setOffsetX(0);
      setOffsetY(0);
      setReady(true);
    };
    image.onerror = () => setError("无法读取这张图片。");
    image.src = url;
  }

  async function submit() {
    const canvas = canvasRef.current;
    if (!canvas || !ready) return;
    setPending(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("encode")), "image/webp", 0.9));
      const body = new FormData();
      body.set("avatar", blob, "avatar.webp");
      const response = await fetch("/api/profile/avatar", { method: "POST", body });
      const result = await response.json() as { picture?: string; error?: string };
      if (!response.ok || !result.picture) throw new Error(result.error || "头像保存失败。");
      setPicture(result.picture);
      if (returnTo) {
        window.location.assign(returnTo);
        return;
      }
      setMessage("头像已更新。已连接的应用将使用新头像。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "头像保存失败。");
    } finally {
      setPending(false);
    }
  }

  return <section className="profile-page">
    <header className="profile-page-header">
      <Link className="brand" href="/">
        <span className="brand-mark" aria-hidden="true" />
        HFLive Auth
      </Link>
      <Link className="secondary-link" href="/">返回首页</Link>
    </header>

    <div className="panel profile-hero">
      <div className="avatar-frame">{picture ? <NextImage src={picture} alt="当前头像" width={160} height={160} unoptimized /> : <span aria-hidden="true">{profile.name.slice(0, 1).toUpperCase()}</span>}</div>
      <div className="profile-hero-copy">
        <p className="eyebrow">个人资料</p>
        <h1 className="profile-title">{profile.name}</h1>
        <p className="profile-handle">@{profile.username ?? "未设置用户名"}</p>
        <p className="auth-copy">这些资料用于 HFLive Auth 和已连接的组织应用。</p>
      </div>
      <span className="account-status">账号正常</span>
    </div>

    <div className="profile-grid">
      <div className="panel profile-details">
        <div className="section-heading">
          <div><p className="eyebrow">基本资料</p><h2>账号信息</h2></div>
          <span className="quiet-badge">集中管理</span>
        </div>
        <dl className="profile-data-list">
          <div><dt>显示名</dt><dd>{profile.name}</dd></div>
          <div><dt>用户名</dt><dd>{profile.username ?? "未设置"}</dd></div>
          <div><dt>邮箱</dt><dd>{profile.email}<small>{profile.emailVerified ? "已验证" : "未验证"}</small></dd></div>
          <div><dt>账号类型</dt><dd>{profile.platformRole === "ADMIN" ? "管理员" : "成员"}</dd></div>
          <div><dt>加入时间</dt><dd>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "long", timeZone: "Asia/Shanghai" }).format(new Date(profile.createdAt))}</dd></div>
        </dl>
        <p className="fine-print">显示名、用户名和邮箱目前由管理员维护。头像可由你自行更新。</p>
      </div>

      <div className="panel crop-panel">
        <div className="section-heading">
          <div><p className="eyebrow">头像</p><h2>更换个人头像</h2></div>
          <span className="quiet-badge editable">可编辑</span>
        </div>
      {!storageEnabled ? <p className="form-error" role="alert">当前自部署实例未启用对象存储，头像功能不可用。</p> : <>
        <label className="file-picker">选择图片<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => selectFile(event.target.files?.[0])} /></label>
        <canvas ref={canvasRef} width={OUTPUT_SIZE} height={OUTPUT_SIZE} className={`crop-canvas${ready ? " ready" : ""}`} aria-label="头像裁切预览" />
        {ready ? <div className="crop-controls">
          <label>缩放 <input type="range" min="1" max="3" step="0.01" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
          <label>水平位置 <input type="range" min="-100" max="100" value={offsetX} onChange={(event) => setOffsetX(Number(event.target.value))} /></label>
          <label>垂直位置 <input type="range" min="-100" max="100" value={offsetY} onChange={(event) => setOffsetY(Number(event.target.value))} /></label>
          <button className="primary-button" type="button" disabled={pending} onClick={submit}>{pending ? "保存中…" : "保存头像"}</button>
        </div> : <p className="fine-print">支持 JPEG、PNG、WebP，图片不超过 8 MiB。保存后会自动处理成适合各应用使用的尺寸。</p>}
      </>}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {message ? <p className="form-success" role="status">{message}</p> : null}
      </div>
    </div>
  </section>;
}
