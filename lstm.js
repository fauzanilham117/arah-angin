// ============================================================
// LSTM FORECAST - FIREBASE
// Menggunakan data valid langsung tanpa resampling per jam
// ============================================================

import { initializeApp } from
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
    getDatabase,
    ref,
    get
} from
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// ============================================================
// KONFIGURASI FIREBASE
// ============================================================

const firebaseConfig = {
    apiKey: "MASUKKAN_API_KEY_ANDA",
    authDomain: "arah-angin-76f91.firebaseapp.com",
    databaseURL: "https://arah-angin-76f91-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "arah-angin-76f91",
    storageBucket: "arah-angin-76f91.firebasestorage.app",
    messagingSenderId: "MASUKKAN_MESSAGING_SENDER_ID",
    appId: "MASUKKAN_APP_ID"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ============================================================
// PENGATURAN LSTM
// ============================================================

// Jumlah data sebelumnya yang digunakan untuk memprediksi
// satu data berikutnya.
//
// CATATAN:
// 24 di sini berarti 24 TITIK DATA,
// bukan otomatis 24 jam.
const LOOKBACK = 24;

// 168 langkah = 7 hari jika satu langkah = 1 jam.
// Jika interval data bukan 1 jam, maka 168 langkah mengikuti
// interval data yang tersedia.
const FORECAST_STEPS = 168;

// ============================================================
// VARIABEL
// ============================================================

let rawData = [];
let validData = [];
let trainingData = [];
let forecastData = [];

let minValue = 0;
let maxValue = 1;

// ============================================================
// LOG
// ============================================================

function log(message) {
    const waktu = new Date().toLocaleTimeString("id-ID");

    console.log(`[${waktu}] ${message}`);

    const logElement = document.getElementById("log");

    if (logElement) {
        logElement.textContent +=
            `[${waktu}] ${message}\n`;

        logElement.scrollTop = logElement.scrollHeight;
    }
}

// ============================================================
// FIREBASE
// ============================================================

async function ambilDataFirebase() {

    log("Mulai membaca Firebase...");

    try {

        const dbRef = ref(db, "cuaca/history");

        const snapshot = await get(dbRef);

        if (!snapshot.exists()) {

            log("Tidak ada data pada cuaca/history.");

            return [];

        }

        const data = snapshot.val();

        let hasil = [];

        // ====================================================
        // FORMAT OBJECT
        // ====================================================

        if (
            typeof data === "object" &&
            !Array.isArray(data)
        ) {

            Object.keys(data).forEach(key => {

                const item = data[key];

                if (
                    item &&
                    typeof item === "object"
                ) {

                    hasil.push({
                        key: key,
                        ...item
                    });

                }

            });

        }

        // ====================================================
        // FORMAT ARRAY
        // ====================================================

        else if (Array.isArray(data)) {

            data.forEach((item, index) => {

                if (
                    item &&
                    typeof item === "object"
                ) {

                    hasil.push({
                        key: index,
                        ...item
                    });

                }

            });

        }

        log(
            `Data Firebase berhasil diterima: ${hasil.length}`
        );

        return hasil;

    } catch (error) {

        console.error(error);

        log(
            "Gagal membaca Firebase: " +
            error.message
        );

        return [];

    }

}

// ============================================================
// MENGAMBIL NILAI LINGKUNGAN
// ============================================================

function ambilNilai(item) {

    // --------------------------------------------------------
    // Prioritas tinggi muka air
    // --------------------------------------------------------

    if (
        item.tinggiAir !== undefined &&
        item.tinggiAir !== null
    ) {

        const nilai = Number(item.tinggiAir);

        if (Number.isFinite(nilai)) {
            return nilai;
        }

    }

    // --------------------------------------------------------
    // tinggi_permukaan_laut
    // --------------------------------------------------------

    if (
        item.tinggi_permukaan_laut !== undefined &&
        item.tinggi_permukaan_laut !== null
    ) {

        const nilai =
            Number(item.tinggi_permukaan_laut);

        if (Number.isFinite(nilai)) {
            return nilai;
        }

    }

    // --------------------------------------------------------
    // tinggi_permukaan_air
    // --------------------------------------------------------

    if (
        item.tinggi_permukaan_air !== undefined &&
        item.tinggi_permukaan_air !== null
    ) {

        const nilai =
            Number(item.tinggi_permukaan_air);

        if (Number.isFinite(nilai)) {
            return nilai;
        }

    }

    // --------------------------------------------------------
    // suhu
    // --------------------------------------------------------

    if (
        item.suhu !== undefined &&
        item.suhu !== null
    ) {

        const nilai = Number(item.suhu);

        if (Number.isFinite(nilai)) {
            return nilai;
        }

    }

    // --------------------------------------------------------
    // kelembapan
    // --------------------------------------------------------

    if (
        item.kelembapan !== undefined &&
        item.kelembapan !== null
    ) {

        const nilai =
            Number(item.kelembapan);

        if (Number.isFinite(nilai)) {
            return nilai;
        }

    }

    // --------------------------------------------------------
    // tekanan
    // --------------------------------------------------------

    if (
        item.tekanan !== undefined &&
        item.tekanan !== null
    ) {

        const nilai =
            Number(item.tekanan);

        if (Number.isFinite(nilai)) {
            return nilai;
        }

    }

    return null;

}

// ============================================================
// MENGAMBIL TIMESTAMP
// ============================================================

function ambilTimestamp(item) {

    const kandidat = [

        item.timestamp,
        item.time,
        item.waktu,
        item.tanggal,
        item.datetime,
        item.date

    ];

    for (const nilai of kandidat) {

        if (
            nilai !== undefined &&
            nilai !== null &&
            nilai !== ""
        ) {

            // Jika timestamp berupa angka
            if (
                typeof nilai === "number" &&
                Number.isFinite(nilai)
            ) {

                return nilai;

            }

            // Jika timestamp berupa string
            const waktu =
                new Date(nilai).getTime();

            if (!Number.isNaN(waktu)) {

                return waktu;

            }

        }

    }

    return null;

}

// ============================================================
// VALIDASI DATA
// ============================================================

function validasiData(data) {

    log("Memeriksa data Firebase...");

    const hasil = [];

    data.forEach((item, index) => {

        const nilai = ambilNilai(item);

        if (
            nilai !== null &&
            Number.isFinite(nilai)
        ) {

            hasil.push({

                index: index,

                timestamp:
                    ambilTimestamp(item),

                value: nilai

            });

        }

    });

    // ========================================================
    // SORT BERDASARKAN WAKTU JIKA TERSEDIA
    // ========================================================

    const memilikiTimestamp =
        hasil.filter(
            item =>
                item.timestamp !== null
        ).length;

    if (
        memilikiTimestamp === hasil.length &&
        hasil.length > 1
    ) {

        hasil.sort(
            (a, b) =>
                a.timestamp - b.timestamp
        );

    }

    log(
        `Data valid setelah konversi: ${hasil.length}`
    );

    return hasil;

}

// ============================================================
// NORMALISASI
// ============================================================

function normalisasiData(data) {

    if (data.length === 0) {
        return [];
    }

    const nilai = data.map(
        item => item.value
    );

    minValue = Math.min(...nilai);
    maxValue = Math.max(...nilai);

    // Jika semua nilai sama
    if (maxValue === minValue) {

        return nilai.map(() => 0.5);

    }

    return nilai.map(
        x =>
            (x - minValue) /
            (maxValue - minValue)
    );

}

// ============================================================
// DENORMALISASI
// ============================================================

function denormalisasi(nilai) {

    if (maxValue === minValue) {

        return minValue;

    }

    return (
        nilai *
        (maxValue - minValue)
    ) + minValue;

}

// ============================================================
// MEMBENTUK SEQUENCE TRAINING
// ============================================================

function buatSequence(dataNormal) {

    const X = [];
    const y = [];

    // ========================================================
    // TIDAK ADA LAGI:
    //
    // resampling per jam
    // agregasi per jam
    // pengelompokan hourly
    //
    // Data langsung digunakan.
    // ========================================================

    for (
        let i = 0;
        i <= dataNormal.length - LOOKBACK - 1;
        i++
    ) {

        const sequence = [];

        for (
            let j = 0;
            j < LOOKBACK;
            j++
        ) {

            sequence.push([
                dataNormal[i + j]
            ]);

        }

        X.push(sequence);

        y.push(
            dataNormal[i + LOOKBACK]
        );

    }

    return {
        X,
        y
    };

}

// ============================================================
// MEMBANGUN MODEL
// ============================================================

function buatModel() {

    const model =
        tf.sequential();

    model.add(
        tf.layers.lstm({

            units: 32,

            inputShape: [
                LOOKBACK,
                1
            ]

        })
    );

    model.add(
        tf.layers.dense({
            units: 1
        })
    );

    model.compile({

        optimizer:
            tf.train.adam(0.001),

        loss: "meanSquaredError"

    });

    return model;

}

// ============================================================
// TRAINING
// ============================================================

async function trainingModel(
    model,
    X,
    y
) {

    const xs =
        tf.tensor3d(
            X
        );

    const ys =
        tf.tensor2d(
            y.map(v => [v])
        );

    log(
        `Training menggunakan ${X.length} sequence.`
    );

    log(
        `Shape X: ${xs.shape.join(" × ")}`
    );

    log(
        `Shape y: ${ys.shape.join(" × ")}`
    );

    const EPOCHS = 50;

    await model.fit(
        xs,
        ys,
        {

            epochs: EPOCHS,

            batchSize: 16,

            shuffle: true,

            validationSplit:
                X.length >= 20
                    ? 0.2
                    : 0,

            callbacks: {

                onEpochEnd:
                    async (epoch, logs) => {

                        if (
                            epoch === 0 ||
                            (epoch + 1) % 5 === 0 ||
                            epoch === EPOCHS - 1
                        ) {

                            log(
                                `Epoch ${
                                    epoch + 1
                                }/${EPOCHS} - loss: ${
                                    logs.loss.toFixed(6)
                                }`
                            );

                        }

                    }

            }

        }
    );

    xs.dispose();
    ys.dispose();

}

// ============================================================
// FORECAST 168 LANGKAH
// ============================================================

async function forecast168(
    model,
    dataNormal
) {

    log(
        `Memulai forecast ${FORECAST_STEPS} langkah...`
    );

    // Ambil LOOKBACK data terakhir
    let sequence =
        dataNormal.slice(
            -LOOKBACK
        );

    const hasil = [];

    for (
        let i = 0;
        i < FORECAST_STEPS;
        i++
    ) {

        const input =
            tf.tensor3d(
                [
                    sequence.map(
                        value => [value]
                    )
                ]
            );

        const prediction =
            model.predict(input);

        const nilaiNormal =
            (
                await prediction
                    .data()
            )[0];

        input.dispose();
        prediction.dispose();

        // Batasi nilai antara 0 dan 1
        const nilaiClamped =
            Math.max(
                0,
                Math.min(
                    1,
                    nilaiNormal
                )
            );

        const nilaiAsli =
            denormalisasi(
                nilaiClamped
            );

        hasil.push(
            nilaiAsli
        );

        // Geser sequence
        sequence =
            sequence.slice(1);

        sequence.push(
            nilaiClamped
        );

        // Beri kesempatan browser
        // memperbarui tampilan
        if (i % 10 === 0) {

            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        0
                    )
            );

        }

    }

    log(
        `Forecast selesai: ${hasil.length} langkah.`
    );

    return hasil;

}

// ============================================================
// MEMBUAT WAKTU FORECAST
// ============================================================

function buatWaktuForecast(
    data
) {

    const timestamps =
        data
            .filter(
                item =>
                    item.timestamp !== null
            )
            .map(
                item =>
                    item.timestamp
            );

    let interval =
        60 * 60 * 1000;

    if (timestamps.length >= 2) {

        const selisih = [];

        for (
            let i = 1;
            i < timestamps.length;
            i++
        ) {

            const d =
                timestamps[i] -
                timestamps[i - 1];

            if (
                d > 0 &&
                Number.isFinite(d)
            ) {

                selisih.push(d);

            }

        }

        if (selisih.length > 0) {

            selisih.sort(
                (a, b) => a - b
            );

            interval =
                selisih[
                    Math.floor(
                        selisih.length / 2
                    )
                ];

        }

    }

    log(
        `Interval data terdeteksi: ${
            (interval / 60000).toFixed(1)
        } menit`
    );

    const timestampTerakhir =
        data[data.length - 1]
            .timestamp;

    const waktuMulai =
        timestampTerakhir !== null
            ? timestampTerakhir
            : Date.now();

    const hasil = [];

    for (
        let i = 1;
        i <= FORECAST_STEPS;
        i++
    ) {

        hasil.push(
            waktuMulai +
            interval * i
        );

    }

    return hasil;

}

// ============================================================
// MENAMPILKAN HASIL
// ============================================================

function tampilkanHasil(
    forecast,
    waktu
) {

    const hasilElement =
        document.getElementById(
            "forecastResult"
        );

    if (!hasilElement) {

        console.table(
            forecast.map(
                (nilai, index) => ({

                    langkah:
                        index + 1,

                    waktu:
                        new Date(
                            waktu[index]
                        ).toLocaleString(
                            "id-ID"
                        ),

                    prediksi:
                        nilai

                })
            )
        );

        return;

    }

    let html = "";

    html += `
        <table>
            <thead>
                <tr>
                    <th>Langkah</th>
                    <th>Waktu</th>
                    <th>Prediksi</th>
                </tr>
            </thead>
            <tbody>
    `;

    forecast.forEach(
        (nilai, index) => {

            html += `
                <tr>
                    <td>
                        ${index + 1}
                    </td>

                    <td>
                        ${
                            new Date(
                                waktu[index]
                            ).toLocaleString(
                                "id-ID"
                            )
                        }
                    </td>

                    <td>
                        ${nilai.toFixed(2)}
                    </td>
                </tr>
            `;

        }
    );

    html += `
            </tbody>
        </table>
    `;

    hasilElement.innerHTML =
        html;

}

// ============================================================
// GRAFIK FORECAST
// ============================================================

function tampilkanGrafik(
    data,
    forecast
) {

    const canvas =
        document.getElementById(
            "lstmChart"
        );

    if (!canvas) {
        return;
    }

    const actual =
        data.map(
            item => item.value
        );

    const actualLabels =
        data.map(
            item => {

                if (
                    item.timestamp !== null
                ) {

                    return new Date(
                        item.timestamp
                    ).toLocaleString(
                        "id-ID",
                        {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit"
                        }
                    );

                }

                return "";

            }
        );

    const forecastLabels =
        forecast.map(
            (_, index) =>
                `F-${index + 1}`
        );

    const labels =
        actualLabels.concat(
            forecastLabels
        );

    const actualData =
        actual.concat(
            Array(
                forecast.length
            ).fill(null)
        );

    const forecastDataChart =
        Array(
            actual.length - 1
        ).fill(null)
            .concat(
                [
                    actual[
                        actual.length - 1
                    ]
                ],
                forecast
            );

    // Hapus chart lama
    if (
        window.lstmChart &&
        typeof window.lstmChart.destroy ===
            "function"
    ) {

        window.lstmChart.destroy();

    }

    window.lstmChart =
        new Chart(
            canvas,
            {

                type: "line",

                data: {

                    labels: labels,

                    datasets: [

                        {

                            label:
                                "Data Aktual",

                            data:
                                actualData,

                            tension:
                                0.25,

                            borderWidth:
                                2,

                            pointRadius:
                                0

                        },

                        {

                            label:
                                "Forecast LSTM",

                            data:
                                forecastDataChart,

                            tension:
                                0.25,

                            borderWidth:
                                2,

                            borderDash:
                                [6, 4],

                            pointRadius:
                                0

                        }

                    ]

                },

                options: {

                    responsive:
                        true,

                    maintainAspectRatio:
                        false,

                    interaction: {

                        mode:
                            "index",

                        intersect:
                            false

                    },

                    scales: {

                        x: {

                            ticks: {

                                maxTicksLimit:
                                    20

                            }

                        },

                        y: {

                            beginAtZero:
                                false

                        }

                    }

                }

            }
        );

}

// ============================================================
// PROSES UTAMA
// ============================================================

async function jalankanLSTM() {

    log("================================");
    log("Memulai proses LSTM...");
    log("================================");

    // --------------------------------------------------------
    // 1. Ambil Firebase
    // --------------------------------------------------------

    rawData =
        await ambilDataFirebase();

    if (
        rawData.length === 0
    ) {

        log(
            "Proses dihentikan: Firebase kosong."
        );

        return;

    }

    // --------------------------------------------------------
    // 2. Validasi
    // --------------------------------------------------------

    validData =
        validasiData(
            rawData
        );

    if (
        validData.length <
        LOOKBACK + 1
    ) {

        log(
            `Data tidak cukup. Minimal ${
                LOOKBACK + 1
            } data valid diperlukan.`
        );

        return;

    }

    // --------------------------------------------------------
    // 3. Normalisasi
    // --------------------------------------------------------

    const dataNormal =
        normalisasiData(
            validData
        );

    // --------------------------------------------------------
    // 4. Sequence training
    // --------------------------------------------------------

    const sequence =
        buatSequence(
            dataNormal
        );

    trainingData =
        sequence;

    log(
        `Data langsung digunakan: ${
            validData.length
        } titik.`
    );

    log(
        `LOOKBACK: ${
            LOOKBACK
        } titik data.`
    );

    log(
        `Sequence training: ${
            sequence.X.length
        } sequence.`
    );

    // --------------------------------------------------------
    // 5. Buat model
    // --------------------------------------------------------

    log(
        "Membuat model LSTM..."
    );

    const model =
        buatModel();

    // --------------------------------------------------------
    // 6. Training
    // --------------------------------------------------------

    await trainingModel(
        model,
        sequence.X,
        sequence.y
    );

    log(
        "Training selesai."
    );

    // --------------------------------------------------------
    // 7. Forecast
    // --------------------------------------------------------

    forecastData =
        await forecast168(
            model,
            dataNormal
        );

    // --------------------------------------------------------
    // 8. Waktu forecast
    // --------------------------------------------------------

    const waktuForecast =
        buatWaktuForecast(
            validData
        );

    // --------------------------------------------------------
    // 9. Tampilkan
    // --------------------------------------------------------

    tampilkanHasil(
        forecastData,
        waktuForecast
    );

    tampilkanGrafik(
        validData,
        forecastData
    );

    log(
        "================================"
    );

    log(
        "Proses LSTM selesai."
    );

    log(
        `Total data valid: ${
            validData.length
        }`
    );

    log(
        `Total sequence: ${
            sequence.X.length
        }`
    );

    log(
        `Total forecast: ${
            forecastData.length
        } langkah`
    );

    log(
        "================================"
    );

    // --------------------------------------------------------
    // 10. Bersihkan model
    // --------------------------------------------------------

    model.dispose();

}

// ============================================================
// EVENT TOMBOL
// ============================================================

const tombol =
    document.getElementById(
        "runLSTM"
    );

if (tombol) {

    tombol.addEventListener(
        "click",
        async () => {

            tombol.disabled =
                true;

            try {

                await jalankanLSTM();

            } catch (error) {

                console.error(error);

                log(
                    "ERROR: " +
                    error.message
                );

            }

            tombol.disabled =
                false;

        }
    );

}

// ============================================================
// STATUS AWAL
// ============================================================

log(
    "Halaman LSTM siap."
);

log(
    "Sumber data: cuaca/history"
);

log(
    `LOOKBACK: ${LOOKBACK} titik data`
);

log(
    `Forecast: ${FORECAST_STEPS} langkah / 168 titik`
);
