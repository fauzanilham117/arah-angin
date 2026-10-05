<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Prediksi Deret Waktu LSTM</title>
  
  <!-- CDN TensorFlow.js & Firebase -->
  <script src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.10.0/dist/tf.min.js"></script>
  <script src="https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js"></script>
  <script src="https://www.gstatic.com/firebasejs/8.10.1/firebase-database.js"></script>
  
  <!-- File Skrip LSTM -->
  <script src="lstm.js"></script>

  <style>
    body {
      font-family: Arial, sans-serif;
      padding: 20px;
      background-color: #f4f7f6;
    }
    .card {
      background: white;
      padding: 20px;
      border-radius: 8px;
      max-width: 600px;
      margin: 0 auto;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    }
    button {
      background-color: #007bff;
      color: white;
      border: none;
      padding: 10px 15px;
      font-size: 16px;
      border-radius: 5px;
      cursor: pointer;
      width: 100%;
    }
    button:disabled {
      background-color: #cccccc;
      cursor: not-allowed;
    }
    #status {
      margin-top: 15px;
      padding: 10px;
      border-radius: 4px;
      display: none;
    }
    .info { background-color: #e7f3fe; color: #31708f; }
    .success { background-color: #dff0d8; color: #3c763d; }
    .error { background-color: #f2dede; color: #a94442; }
  </style>
</head>
<body>

  <div class="card">
    <h2>Sistem Prediksi Cuaca & Air Laut</h2>
    <p>Klik tombol di bawah untuk memuat data dari Firebase dan melatih model LSTM.</p>
    
    <button id="btnMulai">🚀 Mulai Pelatihan & Prediksi</button>
    
    <div id="status"></div>
  </div>

  <script>
    // 1. Konfigurasi Firebase (Sesuaikan dengan kredensial Firebase Anda)
    const firebaseConfig = {
      apiKey: "API_KEY_ANDA",
      authDomain: "PROJECT_ANDA.firebaseapp.com",
      databaseURL: "https://PROJECT_ANDA-default-rtdb.firebaseio.com",
      projectId: "PROJECT_ANDA",
      storageBucket: "PROJECT_ANDA.appspot.com",
      messagingSenderId: "SENDER_ID",
      appId: "APP_ID"
    };

    // Inisialisasi Firebase
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    const db = firebase.database();

    // Elemen UI
    const btnMulai = document.getElementById("btnMulai");
    const statusDiv = document.getElementById("status");

    function showStatus(message, type) {
      statusDiv.style.display = "block";
      statusDiv.className = type;
      statusDiv.innerText = message;
    }

    // 2. Handler Event Tombol Mulai
    btnMulai.addEventListener("click", async () => {
      btnMulai.disabled = true;
      showStatus("Mengambil data dari Firebase...", "info");

      try {
        // Ambil data dari node 'sensor' (atau sesuaikan dengan nama node di Firebase Anda)
        const snapshot = await db.ref("sensor").once("value");
        const rawData = snapshot.val();

        if (!rawData) {
          throw new Error("Data di node 'sensor' kosong atau tidak ditemukan.");
        }

        showStatus("Memulai proses pelatihan model LSTM...", "info");

        // Jalankan fungsi dari lstm.js
        const result = await LSTMPredictor.run(
          rawData, 
          24, // Lookback Hours
          12, // Forecast Steps
          (epoch, total, loss) => {
            showStatus(`Proses Pelatihan: Epoch ${epoch}/${total} - Loss: ${loss.toFixed(5)}`, "info");
          }
        );

        console.log("=== Hasil Histori Cleaned ===", result.historical);
        console.log("=== Hasil Prediksi Masa Depan ===", result.predictions);

        showStatus(`Selesai! Berhasil memprediksi ${result.predictions.length} langkah ke depan. Cek Console browser (F12) untuk melihat data detail.`, "success");

      } catch (error) {
        console.error("Terjadi error saat proses prediksi:", error);
        showStatus("Gagal: " + error.message, "error");
      } finally {
        btnMulai.disabled = false;
      }
    });
  </script>

</body>
</html>
