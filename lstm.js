// ============================================================
// LSTM.JS
// Firebase -> Data Valid -> Sequence -> LSTM
// -> Forecast 168 langkah
//
// TIDAK ADA RESAMPLING PER JAM
// ============================================================


// ============================================================
// CEK TENSORFLOW.JS
// ============================================================

if (typeof tf === "undefined") {

    console.error(
        "TensorFlow.js belum dimuat."
    );

    throw new Error(
        "TensorFlow.js belum dimuat. Periksa lstm.html."
    );

}

console.log(
    "TensorFlow.js:",
    tf.version.tfjs
);


// ============================================================
// FIREBASE
// ============================================================

import {
    initializeApp
} from
"https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
    getDatabase,
    ref,
    get
} from
"https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";


// ============================================================
// FIREBASE CONFIG
// ============================================================
//
// GANTI NILAI DI BAWAH DENGAN CONFIG FIREBASE ANDA.
// Jika index.html Anda sudah berjalan, gunakan konfigurasi
// yang sama.
// ============================================================

const firebaseConfig = {

    apiKey:
        "MASUKKAN_API_KEY_ANDA",

    authDomain:
        "arah-angin-76f91.firebaseapp.com",

    databaseURL:
        "https://arah-angin-76f91-default-rtdb.asia-southeast1.firebasedatabase.app",

    projectId:
        "arah-angin-76f91",

    storageBucket:
        "arah-angin-76f91.firebasestorage.app",

    messagingSenderId:
        "MASUKKAN_MESSAGING_SENDER_ID",

    appId:
        "MASUKKAN_APP_ID"

};


// ============================================================
// INITIALIZE FIREBASE
// ============================================================

const app =
    initializeApp(
        firebaseConfig
    );

const db =
    getDatabase(app);


// ============================================================
// KONFIGURASI LSTM
// ============================================================

// 24 titik data sebelumnya digunakan
// untuk memprediksi titik berikutnya.

const LOOKBACK = 24;


// 168 langkah forecast

const FORECAST_STEPS = 168;


// Jumlah epoch training

const EPOCHS = 50;


// ============================================================
// VARIABEL
// ============================================================

let rawData = [];

let validData = [];

let trainingData = [];

let forecastData = [];

let minValue = 0;

let maxValue = 1;

let lstmChart = null;


// ============================================================
// ELEMENT HTML
// ============================================================

const logElement =
    document.getElementById(
        "log"
    );

const runButton =
    document.getElementById(
        "runLSTM"
    );

const loadingElement =
    document.getElementById(
        "loading"
    );


// ============================================================
// LOG
// ============================================================

function log(message) {

    const waktu =
        new Date()
            .toLocaleTimeString(
                "id-ID"
            );

    console.log(
        `[${waktu}] ${message}`
    );

    if (logElement) {

        logElement.textContent +=
            `[${waktu}] ${message}\n`;

        logElement.scrollTop =
            logElement.scrollHeight;

    }

}


// ============================================================
// AMBIL DATA FIREBASE
// ============================================================

async function ambilDataFirebase() {

    log(
        "Mulai membaca Firebase..."
    );

    const databaseRef =
        ref(
            db,
            "cuaca/history"
        );

    const snapshot =
        await get(
            databaseRef
        );

    if (!snapshot.exists()) {

        throw new Error(
            "Data cuaca/history tidak ditemukan."
        );

    }

    const data =
        snapshot.val();

    const hasil = [];


    // ========================================================
    // FIREBASE OBJECT
    // ========================================================

    if (
        typeof data === "object" &&
        !Array.isArray(data)
    ) {

        Object.keys(data)
            .forEach(
                key => {

                    const item =
                        data[key];

                    if (
                        item &&
                        typeof item === "object"
                    ) {

                        hasil.push({

                            key: key,

                            ...item

                        });

                    }

                }
            );

    }


    // ========================================================
    // FIREBASE ARRAY
    // ========================================================

    else if (
        Array.isArray(data)
    ) {

        data.forEach(
            (item, index) => {

                if (
                    item &&
                    typeof item === "object"
                ) {

                    hasil.push({

                        key: index,

                        ...item

                    });

                }

            }
        );

    }


    log(
        `Data Firebase berhasil diterima: ${hasil.length}`
    );

    return hasil;

}


// ============================================================
// AMBIL NILAI YANG AKAN DIPREDIKSI
// ============================================================
//
// Prioritas:
// 1. tinggiAir
// 2. tinggi_permukaan_laut
// 3. tinggi_permukaan_air
// 4. suhu
// 5. kelembapan
// 6. tekanan
//
// Kalau Anda ingin LSTM hanya memprediksi satu variabel,
// misalnya tinggi muka air, gunakan hanya tinggiAir.
// ============================================================

function ambilNilai(item) {


    // --------------------------------------------------------
    // TINGGI AIR
    // --------------------------------------------------------

    if (
        item.tinggiAir !== undefined &&
        item.tinggiAir !== null
    ) {

        const nilai =
            Number(
                item.tinggiAir
            );

        if (
            Number.isFinite(nilai)
        ) {

            return nilai;

        }

    }


    // --------------------------------------------------------
    // TINGGI PERMUKAAN LAUT
    // --------------------------------------------------------

    if (
        item.tinggi_permukaan_laut !== undefined &&
        item.tinggi_permukaan_laut !== null
    ) {

        const nilai =
            Number(
                item.tinggi_permukaan_laut
            );

        if (
            Number.isFinite(nilai)
        ) {

            return nilai;

        }

    }


    // --------------------------------------------------------
    // TINGGI PERMUKAAN AIR
    // --------------------------------------------------------

    if (
        item.tinggi_permukaan_air !== undefined &&
        item.tinggi_permukaan_air !== null
    ) {

        const nilai =
            Number(
                item.tinggi_permukaan_air
            );

        if (
            Number.isFinite(nilai)
        ) {

            return nilai;

        }

    }


    // --------------------------------------------------------
    // SUHU
    // --------------------------------------------------------

    if (
        item.suhu !== undefined &&
        item.suhu !== null
    ) {

        const nilai =
            Number(
                item.suhu
            );

        if (
            Number.isFinite(nilai)
        ) {

            return nilai;

        }

    }


    // --------------------------------------------------------
    // KELEMBAPAN
    // --------------------------------------------------------

    if (
        item.kelembapan !== undefined &&
        item.kelembapan !== null
    ) {

        const nilai =
            Number(
                item.kelembapan
            );

        if (
            Number.isFinite(nilai)
        ) {

            return nilai;

        }

    }


    // --------------------------------------------------------
    // TEKANAN
    // --------------------------------------------------------

    if (
        item.tekanan !== undefined &&
        item.tekanan !== null
    ) {

        const nilai =
            Number(
                item.tekanan
            );

        if (
            Number.isFinite(nilai)
        ) {

            return nilai;

        }

    }


    return null;

}


// ============================================================
// AMBIL TIMESTAMP
// ============================================================

function ambilTimestamp(item) {

    const kandidat = [

        item.timestamp,

        item.time,

        item.waktu,

        item.datetime,

        item.date,

        item.tanggal

    ];


    for (
        const nilai of kandidat
    ) {

        if (
            nilai === undefined ||
            nilai === null ||
            nilai === ""
        ) {

            continue;

        }


        // ----------------------------------------------------
        // Timestamp angka
        // ----------------------------------------------------

        if (
            typeof nilai === "number" &&
            Number.isFinite(nilai)
        ) {

            return nilai;

        }


        // ----------------------------------------------------
        // Timestamp string
        // ----------------------------------------------------

        const waktu =
            new Date(
                nilai
            ).getTime();


        if (
            !Number.isNaN(waktu)
        ) {

            return waktu;

        }

    }


    return null;

}


// ============================================================
// VALIDASI DATA
// ============================================================

function validasiData(data) {

    log(
        "Memeriksa data Firebase..."
    );

    const hasil = [];


    data.forEach(
        (item, index) => {

            const nilai =
                ambilNilai(
                    item
                );

            if (
                nilai !== null &&
                Number.isFinite(nilai)
            ) {

                hasil.push({

                    index: index,

                    timestamp:
                        ambilTimestamp(
                            item
                        ),

                    value: nilai

                });

            }

        }
    );


    // ========================================================
    // URUTKAN TIMESTAMP
    // ========================================================

    const semuaPunyaWaktu =
        hasil.length > 1 &&
        hasil.every(
            item =>
                item.timestamp !== null
        );


    if (
        semuaPunyaWaktu
    ) {

        hasil.sort(
            (a, b) =>
                a.timestamp -
                b.timestamp
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

    const nilai =
        data.map(
            item =>
                item.value
        );


    minValue =
        Math.min(
            ...nilai
        );


    maxValue =
        Math.max(
            ...nilai
        );


    log(
        `Nilai minimum: ${minValue}`
    );


    log(
        `Nilai maksimum: ${maxValue}`
    );


    if (
        maxValue === minValue
    ) {

        return nilai.map(
            () => 0.5
        );

    }


    return nilai.map(
        nilaiData =>
            (
                nilaiData -
                minValue
            ) /
            (
                maxValue -
                minValue
            )
    );

}


// ============================================================
// DENORMALISASI
// ============================================================

function denormalisasi(nilai) {

    if (
        maxValue === minValue
    ) {

        return minValue;

    }


    return (
        nilai *
        (
            maxValue -
            minValue
        )
    ) + minValue;

}


// ============================================================
// SEQUENCE TRAINING
// ============================================================
//
// CONTOH:
//
// 280 data
// LOOKBACK = 24
//
// Sequence:
// 1  -> data 1-24   -> target 25
// 2  -> data 2-25   -> target 26
// 3  -> data 3-26   -> target 27
// ...
// 256 -> data 256-279 -> target 280
//
// Total = 256 sequence
// ============================================================

function buatSequence(
    dataNormal
) {

    const X = [];

    const y = [];


    for (
        let i = 0;

        i <=
        dataNormal.length -
        LOOKBACK -
        1;

        i++
    ) {

        const sequence = [];


        for (
            let j = 0;

            j < LOOKBACK;

            j++
        ) {

            sequence.push([
                dataNormal[
                    i + j
                ]
            ]);

        }


        X.push(
            sequence
        );


        y.push(
            dataNormal[
                i + LOOKBACK
            ]
        );

    }


    return {
        X,
        y
    };

}


// ============================================================
// MEMBUAT MODEL LSTM
// ============================================================

function buatModel() {

    log(
        "Membuat model LSTM..."
    );


    const model =
        tf.sequential();


    // ========================================================
    // LSTM LAYER
    // ========================================================

    model.add(

        tf.layers.lstm({

            units: 32,

            inputShape: [
                LOOKBACK,
                1
            ]

        })

    );


    // ========================================================
    // OUTPUT
    // ========================================================

    model.add(

        tf.layers.dense({

            units: 1

        })

    );


    // ========================================================
    // COMPILE
    // ========================================================

    model.compile({

        optimizer:
            tf.train.adam(
                0.001
            ),

        loss:
            "meanSquaredError"

    });


    return model;

}


// ============================================================
// TRAINING MODEL
// ============================================================

async function trainingModel(
    model,
    X,
    y
) {

    log(
        "Menyiapkan data training..."
    );


    const xs =
        tf.tensor3d(
            X
        );


    const ys =
        tf.tensor2d(
            y.map(
                nilai => [
                    nilai
                ]
            )
        );


    log(
        `Shape X: ${xs.shape.join(" × ")}`
    );


    log(
        `Shape Y: ${ys.shape.join(" × ")}`
    );


    log(
        `Mulai training ${EPOCHS} epoch...`
    );


    await model.fit(
        xs,
        ys,
        {

            epochs:
                EPOCHS,

            batchSize:
                16,

            shuffle:
                true,

            validationSplit:
                X.length >= 20
                    ? 0.2
                    : 0,

            callbacks: {

                onEpochEnd:
                    async (
                        epoch,
                        logs
                    ) => {

                        if (
                            epoch === 0 ||
                            (epoch + 1) % 5 === 0 ||
                            epoch ===
                                EPOCHS - 1
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


    log(
        "Training selesai."
    );

}


// ============================================================
// FORECAST 168 LANGKAH
// ============================================================

async function forecastLSTM(
    model,
    dataNormal
) {

    log(
        `Memulai forecast ${FORECAST_STEPS} langkah...`
    );


    // Ambil 24 data terakhir

    let sequence =
        dataNormal.slice(
            -LOOKBACK
        );


    const hasil = [];


    // ========================================================
    // FORECAST RECURSIVE
    // ========================================================

    for (
        let i = 0;

        i < FORECAST_STEPS;

        i++
    ) {


        const input =
            tf.tensor3d(
                [
                    sequence.map(
                        nilai => [
                            nilai
                        ]
                    )
                ]
            );


        const prediction =
            model.predict(
                input
            );


        const nilaiPrediksi =
            (
                await prediction.data()
            )[0];


        input.dispose();

        prediction.dispose();


        // ----------------------------------------------------
        // Batasi 0 sampai 1
        // ----------------------------------------------------

        const nilaiNormal =
            Math.max(
                0,
                Math.min(
                    1,
                    nilaiPrediksi
                )
            );


        // ----------------------------------------------------
        // Kembalikan ke satuan asli
        // ----------------------------------------------------

        const nilaiAsli =
            denormalisasi(
                nilaiNormal
            );


        hasil.push(
            nilaiAsli
        );


        // ----------------------------------------------------
        // Geser sequence
        // ----------------------------------------------------

        sequence =
            sequence.slice(
                1
            );


        sequence.push(
            nilaiNormal
        );


        // ----------------------------------------------------
        // Beri browser kesempatan
        // memperbarui tampilan
        // ----------------------------------------------------

        if (
            i % 10 === 0
        ) {

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
// DETEKSI INTERVAL DATA
// ============================================================

function deteksiInterval(
    data
) {

    const timestamp =

        data

            .filter(
                item =>
                    item.timestamp !== null
            )

            .map(
                item =>
                    item.timestamp
            );


    if (
        timestamp.length < 2
    ) {

        // Default 1 jam

        return 60 * 60 * 1000;

    }


    const selisih = [];


    for (
        let i = 1;

        i < timestamp.length;

        i++
    ) {

        const difference =
            timestamp[i] -
            timestamp[i - 1];


        if (
            difference > 0
        ) {

            selisih.push(
                difference
            );

        }

    }


    if (
        selisih.length === 0
    ) {

        return 60 * 60 * 1000;

    }


    // Median

    selisih.sort(
        (a, b) =>
            a - b
    );


    const median =
        selisih[
            Math.floor(
                selisih.length / 2
            )
        ];


    return median;

}


// ============================================================
// WAKTU FORECAST
// ============================================================

function buatWaktuForecast(
    data
) {

    const interval =
        deteksiInterval(
            data
        );


    log(
        `Interval data terdeteksi: ${
            (
                interval /
                60000
            ).toFixed(2)
        } menit`
    );


    const dataTerakhir =
        data[
            data.length - 1
        ];


    const waktuTerakhir =
        dataTerakhir.timestamp !== null

            ? dataTerakhir.timestamp

            : Date.now();


    const waktu = [];


    for (
        let i = 1;

        i <= FORECAST_STEPS;

        i++
    ) {

        waktu.push(

            waktuTerakhir +
            (
                interval *
                i
            )

        );

    }


    return waktu;

}


// ============================================================
// TAMPILKAN INFO
// ============================================================

function tampilkanInfo(
    jumlahData,
    jumlahSequence
) {

    const totalData =
        document.getElementById(
            "totalData"
        );


    const totalSequence =
        document.getElementById(
            "totalSequence"
        );


    const lookbackValue =
        document.getElementById(
            "lookbackValue"
        );


    const forecastValue =
        document.getElementById(
            "forecastValue"
        );


    if (
        totalData
    ) {

        totalData.textContent =
            jumlahData;

    }


    if (
        totalSequence
    ) {

        totalSequence.textContent =
            jumlahSequence;

    }


    if (
        lookbackValue
    ) {

        lookbackValue.textContent =
            LOOKBACK;

    }


    if (
        forecastValue
    ) {

        forecastValue.textContent =
            FORECAST_STEPS;

    }

}


// ============================================================
// TABEL FORECAST
// ============================================================

function tampilkanHasil(
    forecast,
    waktu
) {

    const element =
        document.getElementById(
            "forecastResult"
        );


    if (!element) {

        return;

    }


    let html = `

        <table>

            <thead>

                <tr>

                    <th>
                        Langkah
                    </th>

                    <th>
                        Waktu
                    </th>

                    <th>
                        Prediksi
                    </th>

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
                        ${nilai.toFixed(3)}
                    </td>

                </tr>

            `;

        }
    );


    html += `

            </tbody>

        </table>

    `;


    element.innerHTML =
        html;

}


// ============================================================
// GRAFIK
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


    const aktual =
        data.map(
            item =>
                item.value
        );


    const labelsAktual =
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
                            day:
                                "2-digit",

                            month:
                                "2-digit",

                            hour:
                                "2-digit",

                            minute:
                                "2-digit"
                        }
                    );

                }


                return "";

            }
        );


    const labelsForecast =
        forecast.map(
            (_, index) =>
                `Forecast ${index + 1}`
        );


    const labels =
        labelsAktual.concat(
            labelsForecast
        );


    // ========================================================
    // DATA AKTUAL
    // ========================================================

    const dataAktual =
        aktual.concat(
            Array(
                forecast.length
            ).fill(
                null
            )
        );


    // ========================================================
    // DATA FORECAST
    // ========================================================

    const dataForecast =
        Array(
            Math.max(
                0,
                aktual.length - 1
            )
        )
            .fill(
                null
            )
            .concat(
                [
                    aktual[
                        aktual.length - 1
                    ]
                ],
                forecast
            );


    // ========================================================
    // HAPUS CHART SEBELUMNYA
    // ========================================================

    if (
        lstmChart
    ) {

        lstmChart.destroy();

    }


    // ========================================================
    // BUAT CHART
    // ========================================================

    lstmChart =
        new Chart(
            canvas,
            {

                type:
                    "line",

                data: {

                    labels:
                        labels,

                    datasets: [

                        {

                            label:
                                "Data Aktual",

                            data:
                                dataAktual,

                            borderWidth:
                                2,

                            pointRadius:
                                0,

                            tension:
                                0.25

                        },


                        {

                            label:
                                "Forecast LSTM",

                            data:
                                dataForecast,

                            borderWidth:
                                2,

                            borderDash:
                                [
                                    6,
                                    4
                                ],

                            pointRadius:
                                0,

                            tension:
                                0.25

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


                    plugins: {

                        legend: {

                            display:
                                true

                        }

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

    log(
        "======================================"
    );

    log(
        "MEMULAI PROSES LSTM"
    );

    log(
        "======================================"
    );


    // ========================================================
    // 1. AMBIL FIREBASE
    // ========================================================

    rawData =
        await ambilDataFirebase();


    // ========================================================
    // 2. VALIDASI
    // ========================================================

    validData =
        validasiData(
            rawData
        );


    if (
        validData.length <
        LOOKBACK + 1
    ) {

        throw new Error(

            `Data valid hanya ${
                validData.length
            }. Minimal ${
                LOOKBACK + 1
            } data diperlukan.`

        );

    }


    // ========================================================
    // 3. NORMALISASI
    // ========================================================

    const dataNormal =
        normalisasiData(
            validData
        );


    // ========================================================
    // 4. SEQUENCE
    // ========================================================

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


    tampilkanInfo(

        validData.length,

        sequence.X.length

    );


    // ========================================================
    // 5. BUAT MODEL
    // ========================================================

    const model =
        buatModel();


    // ========================================================
    // 6. TRAINING
    // ========================================================

    await trainingModel(

        model,

        sequence.X,

        sequence.y

    );


    // ========================================================
    // 7. FORECAST
    // ========================================================

    forecastData =
        await forecastLSTM(

            model,

            dataNormal

        );


    // ========================================================
    // 8. WAKTU FORECAST
    // ========================================================

    const waktuForecast =
        buatWaktuForecast(
            validData
        );


    // ========================================================
    // 9. TAMPILKAN TABEL
    // ========================================================

    tampilkanHasil(

        forecastData,

        waktuForecast

    );


    // ========================================================
    // 10. TAMPILKAN GRAFIK
    // ========================================================

    tampilkanGrafik(

        validData,

        forecastData

    );


    // ========================================================
    // 11. SELESAI
    // ========================================================

    log(
        "======================================"
    );

    log(
        "PROSES LSTM SELESAI"
    );

    log(
        `Data valid: ${
            validData.length
        }`
    );

    log(
        `Sequence training: ${
            sequence.X.length
        }`
    );

    log(
        `Forecast: ${
            forecastData.length
        } langkah`
    );

    log(
        "======================================"
    );


    // ========================================================
    // BERSIHKAN MODEL
    // ========================================================

    model.dispose();

}


// ============================================================
// TOMBOL RUN
// ============================================================

if (
    runButton
) {

    runButton.addEventListener(
        "click",
        async () => {

            runButton.disabled =
                true;

            if (
                loadingElement
            ) {

                loadingElement.style.display =
                    "inline";

            }


            try {

                await jalankanLSTM();

            }

            catch (
                error
            ) {

                console.error(
                    error
                );

                log(
                    "ERROR: " +
                    error.message
                );

            }


            runButton.disabled =
                false;


            if (
                loadingElement
            ) {

                loadingElement.style.display =
                    "none";

            }

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
    `FORECAST: ${FORECAST_STEPS} langkah`
);

log(
    "Tidak menggunakan resampling per jam."
);
