import { invoke } from "@tauri-apps/api/core";

export type MaterialUpdateInfo = {
  apiBase: string;
  remoteVersion: string;
  remoteMd5: string;
  localVersion: string;
  localMd5: string;
  upToDate: boolean;
};

export function checkMaterialUpdate(): Promise<MaterialUpdateInfo> {
  return invoke<MaterialUpdateInfo>("check_material_update");
}

export function applyMaterialUpdate(): Promise<string> {
  return invoke<string>("apply_material_update");
}
