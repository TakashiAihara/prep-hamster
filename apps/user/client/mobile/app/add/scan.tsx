import { CameraView, useCameraPermissions } from "expo-camera"
import { router } from "expo-router"
import { useRef, useState } from "react"
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native"
import { useByBarcode } from "@/use-by-barcode"

// カメラスキャン画面。EAN-13 / EAN-8 を読み取って /v1/items/by-barcode に投げる。
// バーコード読取完了 → 詳細画面に push。

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions()
  const { state, submit } = useByBarcode()
  const [scannedOnce, setScannedOnce] = useState(false)
  // CameraView は連続で onBarcodeScanned を発火するので 1 回だけ拾う lock を持つ。
  const lockRef = useRef(false)

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    )
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>カメラの利用許可が必要です</Text>
        <Pressable style={styles.primary} onPress={requestPermission}>
          <Text style={styles.primaryLabel}>許可する</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <View style={styles.cameraContainer}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8"] }}
        onBarcodeScanned={async ({ data }) => {
          if (lockRef.current) return
          lockRef.current = true
          setScannedOnce(true)
          const result = await submit(data)
          if (result) {
            router.replace({
              pathname: "/add/details",
              params: { itemId: result.itemId, productLookup: result.productLookup },
            })
          } else {
            // submit 失敗時はもう一度スキャン可能にする
            lockRef.current = false
          }
        }}
      />
      <View style={styles.overlay}>
        {state.status === "loading" || scannedOnce ? (
          <Text style={styles.overlayText}>商品を確認しています...</Text>
        ) : (
          <Text style={styles.overlayText}>JAN コードに枠を合わせてください</Text>
        )}
        {state.status === "error" ? <Text style={styles.overlayError}>{state.message}</Text> : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  cameraContainer: { flex: 1 },
  camera: { flex: 1 },
  overlay: {
    position: "absolute",
    bottom: 32,
    left: 16,
    right: 16,
    padding: 12,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 12,
    alignItems: "center",
    gap: 4,
  },
  overlayText: { color: "#fff" },
  overlayError: { color: "#ff8a80" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16, gap: 12 },
  message: { fontSize: 14, color: "#333" },
  primary: {
    backgroundColor: "#2c7be5",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  primaryLabel: { color: "#fff", fontWeight: "600" },
})
