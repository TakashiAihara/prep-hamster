import { Image } from "expo-image"
import * as ImageManipulator from "expo-image-manipulator"
import * as ImagePicker from "expo-image-picker"
import { randomUUID } from "expo-crypto"
import { useFocusEffect } from "expo-router"
import { useCallback, useRef, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { PHOTOS_PER_ITEM_MAX } from "@prep-hamster/schema/photo"
import { createAuthFetch, getApiClient, resolveApiBaseUrl } from "@/api"
import {
  createConfirmDeletePhoto,
  deletePhoto,
  listPhotos,
  newPhotoAttempt,
  resizePlan,
  uploadPhoto,
  type FilePart,
  type PhotoAttempt,
  type PhotoDto,
} from "@/photo-upload"

// 在庫詳細の写真欄。写真は item に付くので、同じ item の別の在庫でも同じ写真が出る。
// タグ欄と同じく詳細画面の state とは独立に、focus のたびに自分で取り直す。item が変わったら親が key で作り直す。
// 撮影・選択は expo-image-picker、縮小は expo-image-manipulator (長辺 1280 px の JPEG)。
// 一覧の署名 URL は取るたびに変わるので、画像のキャッシュは URL ではなく photo id で持つ。

type Prepared = { attempt: PhotoAttempt; file: FilePart; size: { width: number; height: number } }

const confirmDelete = createConfirmDeletePhoto({
  os: Platform.OS,
  webConfirm: (message) => window.confirm(message),
  alert: Alert.alert,
})

async function prepare(asset: ImagePicker.ImagePickerAsset): Promise<Prepared> {
  const context = ImageManipulator.ImageManipulator.manipulate(asset.uri)
  const plan = resizePlan(asset.width, asset.height)
  if (plan) context.resize(plan)
  const rendered = await context.renderAsync()
  const out = await rendered.saveAsync({ compress: 0.7, format: ImageManipulator.SaveFormat.JPEG })
  const file: FilePart =
    Platform.OS === "web"
      ? await (await fetch(out.uri)).blob()
      : { uri: out.uri, name: "photo.jpg", type: "image/jpeg" }
  return {
    attempt: newPhotoAttempt(randomUUID),
    file,
    size: { width: out.width, height: out.height },
  }
}

export function PhotoSection({ itemId }: { itemId: string }) {
  const [photos, setPhotos] = useState<PhotoDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [viewing, setViewing] = useState<PhotoDto | null>(null)
  // 拡大表示の中にも同じ error を出すので、開くとき・閉じるときに前の操作の error を持ち越さない
  const showViewer = (photo: PhotoDto | null) => {
    setError(null)
    setViewing(photo)
  }
  // 送信に失敗して結果が分からない写真。縮小した file も同じものを使う (作り直すと大きさが変わり、同じ photoId が拒否される)
  const [pending, setPending] = useState<Prepared | null>(null)
  // 最初の一覧の取得に失敗したときの再試行で進める
  const [reloadKey, setReloadKey] = useState(0)
  const busyRef = useRef(false)
  // 追加・削除が成功するたびに進める。取得の途中で進んだら、遅れて届いた一覧 (古い) は捨てる
  const generationRef = useRef(0)

  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      const startedAt = generationRef.current
      void (async () => {
        const res = await listPhotos(getApiClient(), itemId)
        if (cancelled || generationRef.current !== startedAt) return
        if (res.ok) {
          setPhotos(res.photos)
          setError(null)
        } else {
          setError(res.message)
        }
      })()
      return () => {
        cancelled = true
      }
    }, [itemId, reloadKey]),
  )

  async function send(prepared: Prepared) {
    const res = await uploadPhoto(
      { baseUrl: resolveApiBaseUrl(), fetch: createAuthFetch() },
      itemId,
      prepared.file,
      prepared.size,
      prepared.attempt,
    )
    if (res.ok) {
      generationRef.current++
      setPending(null)
      // 再送で 200 が返った写真は、既にある位置のまま差し替える (末尾に動かさない)
      setPhotos((prev) => {
        const list = prev ?? []
        return list.some((p) => p.id === res.photo.id)
          ? list.map((p) => (p.id === res.photo.id ? res.photo : p))
          : [...list, res.photo]
      })
      return
    }
    setError(res.message)
    // 確定した拒否なら、次に選ぶ写真は新しい photoId。結果が分からない失敗なら同じ photoId で送り直す
    setPending(res.retrySamePhotoId ? prepared : null)
  }

  async function run(job: () => Promise<void>) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      await job()
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown")
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const add = (source: "camera" | "library") =>
    run(async () => {
      // 選択はシステムの写真選択 UI (iOS は PHPicker、Android は photo picker) で、ライブラリ全体の権限は要らない。権限が要るのはカメラだけ
      if (source === "camera") {
        const permission = await ImagePicker.requestCameraPermissionsAsync()
        if (!permission.granted) {
          setError("カメラの権限がありません。端末の設定から許可してください")
          return
        }
      }
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ["images"],
        quality: 1,
        exif: false,
      }
      const picked =
        source === "camera"
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync(options)
      const asset = picked.canceled ? undefined : picked.assets[0]
      if (!asset) return
      const prepared = await prepare(asset)
      setPending(prepared)
      await send(prepared)
    })

  const remove = (photo: PhotoDto) =>
    run(async () => {
      if (!(await confirmDelete())) return
      const res = await deletePhoto(getApiClient(), itemId, photo.id)
      if (!res.ok) return setError(res.message)
      generationRef.current++
      setPhotos((prev) => (prev ?? []).filter((p) => p.id !== photo.id))
      setViewing(null)
    })

  if (photos === null) {
    return error ? (
      <View style={styles.section}>
        <Text style={styles.error} testID="detail-photos-error">
          {error}
        </Text>
        <Pressable
          testID="detail-photos-retry"
          accessibilityRole="button"
          style={styles.action}
          onPress={() => {
            setError(null)
            setReloadKey((n) => n + 1)
          }}
        >
          <Text style={styles.actionLabel}>再試行</Text>
        </Pressable>
      </View>
    ) : (
      <ActivityIndicator />
    )
  }

  const full = photos.length >= PHOTOS_PER_ITEM_MAX

  return (
    <View style={styles.section} testID="detail-photos">
      <Text style={styles.sectionTitle}>写真</Text>
      {photos.length === 0 ? <Text style={styles.meta}>写真はありません</Text> : null}
      <ScrollView horizontal contentContainerStyle={styles.strip}>
        {photos.map((p) => (
          <Pressable
            key={p.id}
            testID={`detail-photo-${p.id}`}
            accessibilityRole="button"
            accessibilityLabel="写真を大きく表示する"
            onPress={() => showViewer(p)}
          >
            {p.url ? (
              <Image
                source={{ uri: p.url, cacheKey: p.id }}
                cachePolicy="disk"
                style={styles.thumb}
                contentFit="cover"
              />
            ) : (
              <View style={[styles.thumb, styles.thumbMissing]} />
            )}
          </Pressable>
        ))}
      </ScrollView>
      <View style={styles.actions}>
        <Pressable
          testID="detail-photo-camera"
          accessibilityRole="button"
          disabled={busy || full}
          onPress={() => void add("camera")}
          style={[styles.action, (busy || full) && styles.disabled]}
        >
          <Text style={styles.actionLabel}>カメラで撮る</Text>
        </Pressable>
        <Pressable
          testID="detail-photo-library"
          accessibilityRole="button"
          disabled={busy || full}
          onPress={() => void add("library")}
          style={[styles.action, (busy || full) && styles.disabled]}
        >
          <Text style={styles.actionLabel}>ライブラリから選ぶ</Text>
        </Pressable>
      </View>
      {full ? (
        <Text style={styles.meta}>写真は 1 つの商品に {PHOTOS_PER_ITEM_MAX} 枚までです</Text>
      ) : null}
      {busy ? <ActivityIndicator /> : null}
      {pending && !busy ? (
        <Pressable
          testID="detail-photo-retry"
          accessibilityRole="button"
          onPress={() => void run(() => send(pending))}
          style={styles.action}
        >
          <Text style={styles.actionLabel}>同じ写真をもう一度送る</Text>
        </Pressable>
      ) : null}
      {error ? (
        <Text style={styles.error} testID="detail-photos-error">
          {error}
        </Text>
      ) : null}
      <Modal
        visible={viewing !== null}
        transparent
        animationType="fade"
        onRequestClose={() => showViewer(null)}
      >
        <View style={styles.viewer}>
          {viewing?.url ? (
            <Image
              source={{ uri: viewing.url, cacheKey: viewing.id }}
              cachePolicy="disk"
              style={styles.large}
              contentFit="contain"
            />
          ) : null}
          {error ? (
            <Text style={styles.viewerError} testID="detail-photo-viewer-error">
              {error}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Pressable
              testID="detail-photo-delete"
              accessibilityRole="button"
              disabled={busy}
              onPress={() => viewing && void remove(viewing)}
              style={[styles.action, busy && styles.disabled]}
            >
              <Text style={styles.deleteLabel}>この写真を削除</Text>
            </Pressable>
            <Pressable
              testID="detail-photo-close"
              accessibilityRole="button"
              onPress={() => showViewer(null)}
              style={styles.action}
            >
              <Text style={styles.closeLabel}>閉じる</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  sectionTitle: { fontSize: 14, fontWeight: "600", color: "#333" },
  meta: { fontSize: 13, color: "#555" },
  strip: { gap: 8 },
  thumb: { width: 84, height: 84, borderRadius: 8, backgroundColor: "#eee" },
  thumbMissing: { borderWidth: 1, borderColor: "#ccc" },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  action: { paddingHorizontal: 12, paddingVertical: 10 },
  actionLabel: { color: "#2c7be5", fontSize: 14, fontWeight: "600" },
  disabled: { opacity: 0.4 },
  error: { color: "#c0392b" },
  viewer: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.9)",
    justifyContent: "center",
    padding: 16,
    gap: 16,
  },
  large: { width: "100%", height: "70%" },
  viewerError: { color: "#ff8a7a", fontSize: 14 },
  deleteLabel: { color: "#ff6b5b", fontSize: 15, fontWeight: "600" },
  closeLabel: { color: "#fff", fontSize: 15, fontWeight: "600" },
})
