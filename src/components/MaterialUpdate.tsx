import { useCallback, useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import {
  applyMaterialUpdate,
  checkMaterialUpdate,
  type MaterialUpdateInfo,
} from "../game/materials";
import { sfx } from "../game/audio";
import { SyncIcon } from "./icons";

type Tone = "info" | "ok" | "error";

function reasonOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "操作失败，请稍后重试";
}

export default function MaterialUpdate() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<MaterialUpdateInfo | null>(null);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<Tone>("info");

  const refresh = useCallback(async () => {
    if (!isTauri()) {
      setTone("error");
      setMessage("浏览器预览无法检查素材更新，请使用桌面应用");
      return;
    }
    setBusy(true);
    setTone("info");
    setMessage("正在检查服务端版本…");
    try {
      const result = await checkMaterialUpdate();
      setInfo(result);
      if (result.upToDate) {
        setTone("ok");
        setMessage(`已是最新素材（${result.remoteVersion}）`);
      } else {
        setTone("info");
        setMessage(`发现新版本 ${result.remoteVersion}，可立即更新`);
      }
    } catch (error) {
      setTone("error");
      setMessage(reasonOf(error));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const update = async () => {
    if (busy) return;
    setBusy(true);
    setTone("info");
    setMessage("正在下载并校验素材…");
    try {
      const version = await applyMaterialUpdate();
      setTone("ok");
      setMessage(`已更新到 ${version}，下一次出题即生效`);
      setInfo((prev) =>
        prev
          ? { ...prev, localVersion: version, localMd5: prev.remoteMd5, upToDate: true }
          : prev,
      );
      sfx.win();
    } catch (error) {
      setTone("error");
      setMessage(reasonOf(error));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (busy) return;
    setOpen(false);
  };

  return (
    <>
      <button
        className="material-entry"
        onClick={() => {
          sfx.tap();
          setOpen(true);
        }}
      >
        <SyncIcon size={16} />
        素材更新
      </button>

      {open && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="素材更新" onClick={close}>
          <div className="material-card" onClick={(event) => event.stopPropagation()}>
            <div className="material-head">
              <h2>素材更新</h2>
              <button className="material-close" onClick={close} aria-label="关闭">
                ×
              </button>
            </div>

            <div className="material-rows">
              <div>
                <span>当前版本</span>
                <b>{info?.localVersion ?? "读取中…"}</b>
              </div>
              <div>
                <span>服务端版本</span>
                <b>{info?.remoteVersion ?? "—"}</b>
              </div>
              <div>
                <span>素材服务</span>
                <code>{info?.apiBase ?? "—"}</code>
              </div>
            </div>

            <p className={`material-status ${tone}`}>{message}</p>

            <div className="material-actions">
              <button className="btn ghost" onClick={() => void refresh()} disabled={busy}>
                重新检查
              </button>
              <button
                className="btn primary"
                onClick={() => void update()}
                disabled={busy || !info || info.upToDate}
              >
                立即更新
              </button>
            </div>

            <p className="material-tip">
              内置素材始终保留；更新只替换本地应用数据目录里的真值库。如需变更素材服务地址，可设置环境变量
              LANGUAGE_API_BASE。
            </p>
          </div>
        </div>
      )}
    </>
  );
}
