import AVFoundation
import AudioToolbox
import CoreAudio
import Darwin
import Foundation
import NaturalLanguage

#if canImport(FoundationModels)
import FoundationModels
#endif
#if canImport(Speech)
import Speech
#endif

@_cdecl("pasteai_apple_string_free")
public func pasteai_apple_string_free(_ ptr: UnsafeMutablePointer<CChar>?) {
    free(ptr)
}

@_cdecl("pasteai_apple_text_availability")
public func pasteai_apple_text_availability(
    outAvailable: UnsafeMutablePointer<Int32>,
    outReason: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>,
    outMessage: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>
) {
    if #available(macOS 26.0, *) {
        fillAvailability(textAvailabilityMac26(), outAvailable, outReason, outMessage)
        return
    }

    fillAvailability(Availability(false, "osTooOld", "Requires macOS 26 or later."), outAvailable, outReason, outMessage)
}

@_cdecl("pasteai_apple_speech_availability")
public func pasteai_apple_speech_availability(
    outAvailable: UnsafeMutablePointer<Int32>,
    outReason: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>,
    outMessage: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>
) {
    if #available(macOS 26.0, *) {
        fillAvailability(runBlocking { await speechAvailabilityMac26() }, outAvailable, outReason, outMessage)
        return
    }

    fillAvailability(Availability(false, "osTooOld", "Requires macOS 26 or later."), outAvailable, outReason, outMessage)
}

@_cdecl("pasteai_apple_improve")
public func pasteai_apple_improve(
    systemPrompt: UnsafePointer<CChar>?,
    text: UnsafePointer<CChar>?,
    outText: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>,
    outError: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>
) -> Int32 {
    outText.pointee = nil
    outError.pointee = nil

    guard #available(macOS 26.0, *) else {
        outError.pointee = dup("Requires macOS 26 or later.")
        return 1
    }

    let system = systemPrompt.map { String(cString: $0) } ?? ""
    let prompt = text.map { String(cString: $0) } ?? ""
    do {
        let result = try runBlocking { try await improveMac26(system: system, text: prompt) }
        outText.pointee = dup(result)
        return 0
    } catch {
        outError.pointee = dup(improveErrorMessage(error))
        return 1
    }
}

public typealias PasteAILevelCallback = @convention(c) (Float, UnsafeMutableRawPointer?) -> Void

@_cdecl("pasteai_apple_dictation_start")
public func pasteai_apple_dictation_start(
    levelCb: PasteAILevelCallback?,
    ctx: UnsafeMutableRawPointer?,
    language: UnsafePointer<CChar>?,
    deviceUID: UnsafePointer<CChar>?,
    outError: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>
) -> Int32 {
    outError.pointee = nil
    guard #available(macOS 26.0, *) else {
        outError.pointee = dup("Requires macOS 26 or later.")
        return 1
    }

    let languagesValue = language.map { String(cString: $0) } ?? ""
    let deviceValue = deviceUID.map { String(cString: $0) } ?? ""
    do {
        try runBlocking {
            try await DictationSession.shared.start(
                levelCb: levelCb,
                ctx: ctx,
                languages: languagesValue,
                deviceUID: deviceValue
            )
        }
        return 0
    } catch {
        outError.pointee = dup(error.localizedDescription)
        return 1
    }
}

@_cdecl("pasteai_apple_list_speech_languages")
public func pasteai_apple_list_speech_languages(
    outJson: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>,
    outError: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>
) -> Int32 {
    outJson.pointee = nil
    outError.pointee = nil
    do {
        let catalog: SpeechLanguageCatalogDTO
        if #available(macOS 26.0, *) {
            catalog = runBlocking { await listSpeechLanguagesMac26() }
        } else {
            catalog = fallbackSpeechLanguageCatalog()
        }
        let data = try JSONEncoder().encode(catalog)
        outJson.pointee = dup(String(data: data, encoding: .utf8) ?? "{}")
        return 0
    } catch {
        outError.pointee = dup(error.localizedDescription)
        return 1
    }
}

@_cdecl("pasteai_apple_install_speech_language")
public func pasteai_apple_install_speech_language(
    code: UnsafePointer<CChar>?,
    outError: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>
) -> Int32 {
    outError.pointee = nil
    guard #available(macOS 26.0, *) else {
        outError.pointee = dup("Requires macOS 26 or later.")
        return 1
    }

    let languageCode = code.map { String(cString: $0) } ?? ""
    do {
        try runBlocking { try await installSpeechLanguageMac26(languageCode) }
        return 0
    } catch {
        outError.pointee = dup(error.localizedDescription)
        return 1
    }
}

@_cdecl("pasteai_apple_list_input_devices")
public func pasteai_apple_list_input_devices(
    outJson: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>,
    outError: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>
) -> Int32 {
    outJson.pointee = nil
    outError.pointee = nil
    do {
        let data = try JSONEncoder().encode(listAudioInputDevices())
        outJson.pointee = dup(String(data: data, encoding: .utf8) ?? "[]")
        return 0
    } catch {
        outError.pointee = dup(error.localizedDescription)
        return 1
    }
}

@_cdecl("pasteai_apple_dictation_stop")
public func pasteai_apple_dictation_stop(
    outText: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>,
    outError: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>
) -> Int32 {
    outText.pointee = nil
    outError.pointee = nil
    guard #available(macOS 26.0, *) else {
        outError.pointee = dup("Requires macOS 26 or later.")
        return 1
    }

    do {
        let transcript = try runBlocking { try await DictationSession.shared.stop() }
        outText.pointee = dup(transcript)
        return 0
    } catch {
        outError.pointee = dup(error.localizedDescription)
        return 1
    }
}

@_cdecl("pasteai_apple_dictation_cancel")
public func pasteai_apple_dictation_cancel() {
    if #available(macOS 26.0, *) {
        runBlocking { await DictationSession.shared.cancel() }
    }
}

private struct SpeechLanguageDTO: Encodable {
    let code: String
    let label: String
}

private struct SpeechLanguageCatalogDTO: Encodable {
    let languages: [SpeechLanguageDTO]
    let maxActiveLanguages: Int
}

private let fallbackSpeechLanguageCodes = [
    "ar", "da", "de", "en", "es", "fi", "fr", "he", "it", "ja", "ko",
    "ms", "nb", "nl", "pt", "ru", "sv", "th", "tr", "vi", "yue", "zh"
]

private func fallbackSpeechLanguageCatalog() -> SpeechLanguageCatalogDTO {
    speechLanguageCatalog(codes: fallbackSpeechLanguageCodes, maxActive: 2)
}

private func speechLanguageCatalog(codes: [String], maxActive: Int) -> SpeechLanguageCatalogDTO {
    let english = Locale(identifier: "en")
    let languages = codes.map { code in
        SpeechLanguageDTO(code: code, label: english.localizedString(forLanguageCode: code) ?? code)
    }.sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
    return SpeechLanguageCatalogDTO(languages: languages, maxActiveLanguages: max(1, maxActive))
}

private struct Availability: Sendable {
    let available: Bool
    let code: String
    let message: String

    init(_ available: Bool, _ code: String, _ message: String) {
        self.available = available
        self.code = code
        self.message = message
    }
}

private func fillAvailability(
    _ value: Availability,
    _ outAvailable: UnsafeMutablePointer<Int32>,
    _ outReason: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>,
    _ outMessage: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>
) {
    outAvailable.pointee = value.available ? 1 : 0
    outReason.pointee = dup(value.code)
    outMessage.pointee = dup(value.message)
}

private func dup(_ value: String) -> UnsafeMutablePointer<CChar>? {
    strdup(value)
}

private func runBlocking<T: Sendable>(_ work: @escaping @Sendable () async throws -> T) throws -> T {
    let semaphore = DispatchSemaphore(value: 0)
    var result: Result<T, Error>?
    Task {
        do {
            result = .success(try await work())
        } catch {
            result = .failure(error)
        }
        semaphore.signal()
    }
    semaphore.wait()
    switch result {
    case .success(let value):
        return value
    case .failure(let error):
        throw error
    case nil:
        throw NSError(domain: "pasteAI", code: 1, userInfo: [NSLocalizedDescriptionKey: "Apple Intelligence call did not complete"])
    }
}

private func runBlocking<T: Sendable>(_ work: @escaping @Sendable () async -> T) -> T {
    let semaphore = DispatchSemaphore(value: 0)
    let box = CompletionBox<T>()
    Task {
        await box.set(work())
        semaphore.signal()
    }
    semaphore.wait()
    return box.take()
}

private final class CompletionBox<T>: @unchecked Sendable {
    private var value: T?

    func set(_ value: T) async {
        self.value = value
    }

    func take() -> T {
        value!
    }
}

@available(macOS 26.0, *)
private func textAvailabilityMac26() -> Availability {
#if canImport(FoundationModels)
    switch SystemLanguageModel.default.availability {
    case .available:
        return Availability(true, "available", "")
    case .unavailable(.deviceNotEligible):
        return Availability(false, "deviceNotEligible", "This Mac does not support Apple Intelligence.")
    case .unavailable(.appleIntelligenceNotEnabled):
        return Availability(false, "appleIntelligenceNotEnabled", "Turn on Apple Intelligence in System Settings.")
    case .unavailable(.modelNotReady):
        return Availability(false, "modelNotReady", "Apple Intelligence is still downloading on this Mac.")
    case .unavailable:
        return Availability(false, "unavailable", "Apple Intelligence is not available on this Mac.")
    @unknown default:
        return Availability(false, "unavailable", "Apple Intelligence is not available on this Mac.")
    }
#else
    return Availability(false, "osTooOld", "Requires macOS 26 or later.")
#endif
}

@available(macOS 26.0, *)
private func improveMac26(system: String, text: String) async throws -> String {
#if canImport(FoundationModels)
    switch SystemLanguageModel.default.availability {
    case .available:
        break
    case .unavailable(.deviceNotEligible):
        throw NSError(domain: "pasteAI", code: 2, userInfo: [NSLocalizedDescriptionKey: "This Mac does not support Apple Intelligence."])
    case .unavailable(.appleIntelligenceNotEnabled):
        throw NSError(domain: "pasteAI", code: 2, userInfo: [NSLocalizedDescriptionKey: "Turn on Apple Intelligence in System Settings."])
    case .unavailable(.modelNotReady):
        throw NSError(domain: "pasteAI", code: 2, userInfo: [NSLocalizedDescriptionKey: "Apple Intelligence is still downloading on this Mac."])
    case .unavailable:
        throw NSError(domain: "pasteAI", code: 2, userInfo: [NSLocalizedDescriptionKey: "Apple Intelligence is not available on this Mac."])
    @unknown default:
        throw NSError(domain: "pasteAI", code: 2, userInfo: [NSLocalizedDescriptionKey: "Apple Intelligence is not available on this Mac."])
    }

    let session = LanguageModelSession(instructions: appleInstructions(system: system, text: text))
    let response = try await session.respond(to: text)
    return response.content
#else
    throw NSError(domain: "pasteAI", code: 2, userInfo: [NSLocalizedDescriptionKey: "Requires macOS 26 or later."])
#endif
}

private func appleInstructions(system: String, text: String) -> String {
    guard let language = NLLanguageRecognizer.dominantLanguage(for: text) else {
        return system
    }
    let name = Locale(identifier: "en").localizedString(forLanguageCode: language.rawValue) ?? language.rawValue
    return "\(system)\nYou MUST write the edited text in \(name)."
}

private func improveErrorMessage(_ error: Error) -> String {
#if canImport(FoundationModels)
    if #available(macOS 26.0, *) {
        if let generation = error as? LanguageModelSession.GenerationError {
            switch generation {
            case .exceededContextWindowSize:
                return "Text is too long for Apple Intelligence (on-device limit)."
            case .guardrailViolation:
                return "Apple Intelligence refused this request."
            case .refusal(_, let refusal):
                return String(describing: refusal)
            default:
                break
            }
        }
    }
#endif
    return error.localizedDescription
}

@available(macOS 26.0, *)
private func speechAvailabilityMac26() async -> Availability {
#if canImport(Speech)
    guard SpeechTranscriber.isAvailable else {
        return Availability(false, "notAvailable", "On-device speech recognition is not available on this Mac.")
    }

    let supported = await SpeechTranscriber.supportedLocales
    guard !supported.isEmpty else {
        return Availability(false, "notAvailable", "On-device speech recognition is not available on this Mac.")
    }

    return Availability(true, "available", "")
#else
    return Availability(false, "osTooOld", "Requires macOS 26 or later.")
#endif
}

@available(macOS 26.0, *)
private func listSpeechLanguagesMac26() async -> SpeechLanguageCatalogDTO {
#if canImport(Speech)
    let supported = await SpeechTranscriber.supportedLocales
    var seen = Set<String>()
    var codes: [String] = []
    for locale in supported {
        guard let code = locale.language.languageCode?.identifier.lowercased() else {
            continue
        }
        if seen.insert(code).inserted {
            codes.append(code)
        }
    }
    let maxActive = AssetInventory.maximumReservedLocales
    return speechLanguageCatalog(codes: codes, maxActive: maxActive)
#else
    return fallbackSpeechLanguageCatalog()
#endif
}

@available(macOS 26.0, *)
private func installSpeechLanguageMac26(_ code: String) async throws {
#if canImport(Speech)
    let locales = await resolveSpeechLocales(codes: [code])
    guard let locale = locales.first else {
        throw NSError(domain: "pasteAI", code: 3, userInfo: [NSLocalizedDescriptionKey: "On-device speech recognition does not support this language."])
    }
    try await SpeechAssetInstaller.shared.ensureInstalled(locale: locale)
#else
    throw NSError(domain: "pasteAI", code: 3, userInfo: [NSLocalizedDescriptionKey: "Requires macOS 26 or later."])
#endif
}

@available(macOS 26.0, *)
private func resolveSpeechLocales(fromJoined language: String) async -> [Locale] {
    let codes = language.split(separator: ",").map { String($0) }
    return await resolveSpeechLocales(codes: codes)
}

@available(macOS 26.0, *)
private func resolveSpeechLocales(codes: [String]) async -> [Locale] {
#if canImport(Speech)
    var locales: [Locale] = []
    var seen = Set<String>()
    for raw in codes {
        let code = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !code.isEmpty, code != "auto" else {
            continue
        }
        let hint: String
        switch code {
        case "de":
            hint = "de_DE"
        case "en":
            hint = "en_US"
        default:
            hint = code
        }
        guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: hint)) else {
            continue
        }
        if seen.insert(locale.identifier(.bcp47)).inserted {
            locales.append(locale)
        }
    }
    return locales
#else
    return []
#endif
}

#if canImport(Speech)
@available(macOS 26.0, *)
private func speechTranscriberPreset() -> SpeechTranscriber.Preset {
    var preset = SpeechTranscriber.Preset.transcription
    preset.attributeOptions.insert(.transcriptionConfidence)
    return preset
}

@available(macOS 26.0, *)
private func meanSpeechConfidence(_ text: AttributedString) -> Double? {
    var total = 0.0
    var count = 0
    for run in text.runs {
        if let value = run.transcriptionConfidence {
            total += value
            count += 1
        }
    }
    return count > 0 ? total / Double(count) : nil
}

@available(macOS 26.0, *)
private final class TranscriptLane: @unchecked Sendable {
    let transcriber: SpeechTranscriber
    let locale: Locale
    var finalParts: [String] = []
    var volatile = ""
    var confidenceTotal = 0.0
    var confidenceCount = 0

    init(transcriber: SpeechTranscriber, locale: Locale) {
        self.transcriber = transcriber
        self.locale = locale
    }

    var text: String {
        (finalParts + [volatile])
            .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var meanConfidence: Double {
        confidenceCount > 0 ? confidenceTotal / Double(confidenceCount) : 0
    }
}
#endif

#if canImport(Speech)
@available(macOS 26.0, *)
private final class SpeechAssetInstaller: @unchecked Sendable {
    static let shared = SpeechAssetInstaller()

    private let lock = NSLock()
    private var inFlight: [String: Task<Void, Error>] = [:]
    private var succeeded: Set<String> = []

    func ensureInstalled(locale: Locale) async throws {
        let key = localeKey(locale)
        if isSucceeded(key) {
            return
        }
        let transcriber = SpeechTranscriber(locale: locale, preset: speechTranscriberPreset())
        if await assetsReady(transcriber: transcriber, locale: locale) {
            return
        }
        try await taskFor(locale: locale, key: key).value
    }

    private func taskFor(locale: Locale, key: String) -> Task<Void, Error> {
        lock.lock()
        if let existing = inFlight[key] {
            lock.unlock()
            return existing
        }
        let task = Task<Void, Error> {
            do {
                try await AssetInventory.reserve(locale: locale)
                let transcriber = SpeechTranscriber(locale: locale, preset: speechTranscriberPreset())
                if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
                    try await request.downloadAndInstall()
                }
                self.lock.lock()
                self.succeeded.insert(key)
                self.inFlight[key] = nil
                self.lock.unlock()
            } catch {
                self.lock.lock()
                self.succeeded.remove(key)
                self.inFlight[key] = nil
                self.lock.unlock()
                throw error
            }
        }
        inFlight[key] = task
        lock.unlock()
        return task
    }

    private func isSucceeded(_ key: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return succeeded.contains(key)
    }

    private func localeKey(_ locale: Locale) -> String {
        locale.identifier(.bcp47)
    }

    private func assetsReady(transcriber: SpeechTranscriber, locale: Locale) async -> Bool {
        if await AssetInventory.status(forModules: [transcriber]) == .installed {
            return true
        }
        let wanted = localeKey(locale)
        let installed = await SpeechTranscriber.installedLocales
        return installed.contains { $0.identifier(.bcp47) == wanted }
    }
}
#endif

@available(macOS 26.0, *)
private final class DictationSession: @unchecked Sendable {
    static let shared = DictationSession()

    private let lock = NSLock()
    private var engine: AVAudioEngine?
    private var lanes: [TranscriptLane] = []
    private var analyzer: SpeechAnalyzer?
    private var inputBuilder: AsyncStream<AnalyzerInput>.Continuation?
    private var resultsTask: Task<Void, Never>?
    private var reservedLocales: [Locale] = []
    private var converter: AVAudioConverter?
    private var levelCb: PasteAILevelCallback?
    private var levelCtx: UnsafeMutableRawPointer?
    private var running = false

    func start(
        levelCb: PasteAILevelCallback?,
        ctx: UnsafeMutableRawPointer?,
        languages: String,
        deviceUID: String
    ) async throws {
        lock.lock()
        let alreadyRunning = running
        lock.unlock()
        if alreadyRunning {
            await cancel()
        }

#if canImport(Speech)
        guard SpeechTranscriber.isAvailable else {
            throw NSError(domain: "pasteAI", code: 3, userInfo: [NSLocalizedDescriptionKey: "On-device speech recognition is not available on this Mac."])
        }
        let resolved = await resolveSpeechLocales(fromJoined: languages)
        let maxActive = max(1, AssetInventory.maximumReservedLocales)
        let locales = Array(resolved.prefix(maxActive))
        guard !locales.isEmpty else {
            throw NSError(domain: "pasteAI", code: 3, userInfo: [NSLocalizedDescriptionKey: "On-device speech recognition does not support these languages."])
        }

        var installed: [Locale] = []
        for locale in locales {
            try await SpeechAssetInstaller.shared.ensureInstalled(locale: locale)
            installed.append(locale)
        }

        let preset = speechTranscriberPreset()
        let lanes = installed.map { locale in
            TranscriptLane(transcriber: SpeechTranscriber(locale: locale, preset: preset), locale: locale)
        }
        let modules: [any SpeechModule] = lanes.map(\.transcriber)

        let engine = AVAudioEngine()
        let input = engine.inputNode
        if !deviceUID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            try setEngineInputDevice(engine, uid: deviceUID)
        }
        engine.prepare()
        let hwFormat = try microphoneFormat(input)
        guard let audioFormat = await SpeechAnalyzer.bestAvailableAudioFormat(
            compatibleWith: modules,
            considering: hwFormat
        ) else {
            for locale in installed {
                await AssetInventory.release(reservedLocale: locale)
            }
            throw NSError(domain: "pasteAI", code: 3, userInfo: [NSLocalizedDescriptionKey: "On-device speech recognition is not available on this Mac."])
        }

        let converter: AVAudioConverter?
        if formatsMatch(hwFormat, audioFormat) {
            converter = nil
        } else {
            guard let created = AVAudioConverter(from: hwFormat, to: audioFormat) else {
                for locale in installed {
                    await AssetInventory.release(reservedLocale: locale)
                }
                throw NSError(domain: "pasteAI", code: 4, userInfo: [NSLocalizedDescriptionKey: "Could not convert microphone audio."])
            }
            created.primeMethod = .none
            converter = created
        }

        let analyzer = SpeechAnalyzer(modules: modules)
        try await analyzer.prepareToAnalyze(in: audioFormat)
        let (inputSequence, inputBuilder) = AsyncStream.makeStream(of: AnalyzerInput.self)

        lock.lock()
        self.levelCb = levelCb
        self.levelCtx = ctx
        self.engine = engine
        self.lanes = lanes
        self.analyzer = analyzer
        self.inputBuilder = inputBuilder
        self.reservedLocales = installed
        self.converter = converter
        self.running = true
        lock.unlock()

        resultsTask = Task { [weak self] in
            guard let self else { return }
            await withTaskGroup(of: Void.self) { group in
                for lane in lanes {
                    group.addTask {
                        do {
                            for try await result in lane.transcriber.results {
                                let piece = String(result.text.characters)
                                let confidence = meanSpeechConfidence(result.text)
                                self.lock.lock()
                                if result.isFinal {
                                    lane.finalParts.append(piece)
                                    lane.volatile = ""
                                } else {
                                    lane.volatile = piece
                                }
                                if let confidence {
                                    lane.confidenceTotal += confidence
                                    lane.confidenceCount += 1
                                }
                                self.lock.unlock()
                            }
                        } catch {
                            // Result stream ends when the analyzer finishes or fails.
                        }
                    }
                }
            }
        }

        try await analyzer.start(inputSequence: inputSequence)
        input.installTap(onBus: 0, bufferSize: 4096, format: hwFormat) { [weak self] buffer, _ in
            self?.handleBuffer(buffer, analyzerFormat: audioFormat)
        }
        try engine.start()
#else
        throw NSError(domain: "pasteAI", code: 3, userInfo: [NSLocalizedDescriptionKey: "Requires macOS 26 or later."])
#endif
    }

    func stop() async throws -> String {
        let transcript = await finish(canceling: false)
        return transcript
    }

    func cancel() async {
        _ = await finish(canceling: true)
    }

    private func finish(canceling: Bool) async -> String {
        lock.lock()
        let engine = self.engine
        let analyzer = self.analyzer
        let inputBuilder = self.inputBuilder
        let resultsTask = self.resultsTask
        let locales = reservedLocales
        let lanes = self.lanes
        let wasRunning = running
        self.engine = nil
        self.analyzer = nil
        self.inputBuilder = nil
        self.resultsTask = nil
        self.lanes = []
        self.converter = nil
        self.reservedLocales = []
        self.levelCb = nil
        self.levelCtx = nil
        self.running = false
        lock.unlock()

        guard wasRunning else {
            return ""
        }

        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop()
        inputBuilder?.finish()

        if canceling {
            await analyzer?.cancelAndFinishNow()
        } else {
            try? await analyzer?.finalizeAndFinishThroughEndOfInput()
        }

        _ = await resultsTask?.value

        for locale in locales {
            await AssetInventory.release(reservedLocale: locale)
        }

        return pickTranscript(lanes)
    }

    private func pickTranscript(_ lanes: [TranscriptLane]) -> String {
        func score(_ lane: TranscriptLane) -> Double {
            let text = lane.text
            guard !text.isEmpty else {
                return -1
            }
            var value = lane.meanConfidence
            if let code = lane.locale.language.languageCode?.identifier,
               NLLanguageRecognizer.dominantLanguage(for: text)?.rawValue.hasPrefix(code) == true {
                value += 0.2
            }
            return value
        }
        return lanes.max { score($0) < score($1) }?.text ?? ""
    }

    private func microphoneFormat(_ input: AVAudioInputNode) throws -> AVAudioFormat {
        let hardware = input.inputFormat(forBus: 0)
        if hardware.sampleRate >= 1, hardware.channelCount >= 1 {
            return hardware
        }
        let output = input.outputFormat(forBus: 0)
        if output.sampleRate >= 1, output.channelCount >= 1 {
            return output
        }
        throw NSError(domain: "pasteAI", code: 5, userInfo: [NSLocalizedDescriptionKey: "Could not access the microphone."])
    }

    private func formatsMatch(_ left: AVAudioFormat, _ right: AVAudioFormat) -> Bool {
        left.sampleRate == right.sampleRate
            && left.channelCount == right.channelCount
            && left.commonFormat == right.commonFormat
    }

    private func handleBuffer(_ buffer: AVAudioPCMBuffer, analyzerFormat: AVAudioFormat) {
        reportLevel(buffer)

        lock.lock()
        let builder = inputBuilder
        let converter = converter
        lock.unlock()
        guard let builder else { return }

        do {
            let converted = try convert(buffer, to: analyzerFormat, converter: converter)
            guard converted.frameLength > 0 else {
                return
            }
            builder.yield(AnalyzerInput(buffer: converted))
        } catch {
            // Drop a buffer rather than killing the session on a single conversion miss.
        }
    }

    private func convert(
        _ buffer: AVAudioPCMBuffer,
        to format: AVAudioFormat,
        converter: AVAudioConverter?
    ) throws -> AVAudioPCMBuffer {
        if formatsMatch(buffer.format, format) {
            return buffer
        }

        guard let converter else {
            throw NSError(domain: "pasteAI", code: 4, userInfo: [NSLocalizedDescriptionKey: "Could not convert microphone audio."])
        }

        let ratio = format.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up) + 32)
        guard let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else {
            throw NSError(domain: "pasteAI", code: 4, userInfo: [NSLocalizedDescriptionKey: "Could not convert microphone audio."])
        }

        var got = false
        var error: NSError?
        converter.convert(to: output, error: &error) { _, status in
            if got {
                status.pointee = .noDataNow
                return nil
            }
            got = true
            status.pointee = .haveData
            return buffer
        }
        if let error {
            throw error
        }
        guard output.frameLength > 0 else {
            throw NSError(domain: "pasteAI", code: 4, userInfo: [NSLocalizedDescriptionKey: "Could not convert microphone audio."])
        }
        return output
    }

    private func reportLevel(_ buffer: AVAudioPCMBuffer) {
        guard let channel = buffer.floatChannelData?.pointee else { return }
        let count = Int(buffer.frameLength)
        guard count > 0 else { return }

        var sum: Float = 0
        for index in 0..<count {
            let sample = channel[index]
            sum += sample * sample
        }
        let level = min(1, sqrt(sum / Float(count)) * 8)

        lock.lock()
        let callback = levelCb
        let ctx = levelCtx
        lock.unlock()
        callback?(level, ctx)
    }
}

private struct AudioInputDeviceDTO: Encodable {
    let id: String
    let label: String
}

private func listAudioInputDevices() -> [AudioInputDeviceDTO] {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDevices,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var size: UInt32 = 0
    let sizeStatus = AudioObjectGetPropertyDataSize(
        AudioObjectID(kAudioObjectSystemObject),
        &address,
        0,
        nil,
        &size
    )
    guard sizeStatus == noErr, size > 0 else {
        return []
    }

    let count = Int(size) / MemoryLayout<AudioDeviceID>.size
    var deviceIDs = [AudioDeviceID](repeating: 0, count: count)
    let status = AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject),
        &address,
        0,
        nil,
        &size,
        &deviceIDs
    )
    guard status == noErr else {
        return []
    }

    return deviceIDs.compactMap { deviceID in
        guard inputChannelCount(deviceID) > 0 else {
            return nil
        }
        guard let uid = audioDeviceUID(deviceID), let name = audioDeviceName(deviceID) else {
            return nil
        }
        return AudioInputDeviceDTO(id: uid, label: name)
    }
}

private func setEngineInputDevice(_ engine: AVAudioEngine, uid: String) throws {
    guard let deviceID = audioDeviceID(forUID: uid) else {
        throw NSError(domain: "pasteAI", code: 5, userInfo: [NSLocalizedDescriptionKey: "Selected microphone is not available."])
    }
    guard let audioUnit = engine.inputNode.audioUnit else {
        throw NSError(domain: "pasteAI", code: 5, userInfo: [NSLocalizedDescriptionKey: "Could not access the audio input unit."])
    }

    var selectedID = deviceID
    let status = AudioUnitSetProperty(
        audioUnit,
        kAudioOutputUnitProperty_CurrentDevice,
        kAudioUnitScope_Global,
        0,
        &selectedID,
        UInt32(MemoryLayout<AudioDeviceID>.size)
    )
    if status != noErr {
        throw NSError(domain: "pasteAI", code: 5, userInfo: [NSLocalizedDescriptionKey: "Could not use the selected microphone."])
    }
}

private func audioDeviceID(forUID uid: String) -> AudioDeviceID? {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyTranslateUIDToDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var deviceID = AudioDeviceID()
    var qualifier = uid as CFString
    var size = UInt32(MemoryLayout<AudioDeviceID>.size)
    let status = AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject),
        &address,
        UInt32(MemoryLayout<CFString>.size),
        &qualifier,
        &size,
        &deviceID
    )
    guard status == noErr, deviceID != kAudioObjectUnknown else {
        return nil
    }
    return deviceID
}

private func audioDeviceUID(_ deviceID: AudioDeviceID) -> String? {
    cfStringProperty(deviceID, kAudioDevicePropertyDeviceUID)
}

private func audioDeviceName(_ deviceID: AudioDeviceID) -> String? {
    cfStringProperty(deviceID, kAudioObjectPropertyName)
}

private func cfStringProperty(_ deviceID: AudioDeviceID, _ selector: AudioObjectPropertySelector) -> String? {
    var address = AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var value: Unmanaged<CFString>?
    var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    let status = AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, &value)
    guard status == noErr, let value else {
        return nil
    }
    return value.takeUnretainedValue() as String
}

private func inputChannelCount(_ deviceID: AudioDeviceID) -> Int {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyStreamConfiguration,
        mScope: kAudioObjectPropertyScopeInput,
        mElement: kAudioObjectPropertyElementMain
    )
    var size: UInt32 = 0
    let sizeStatus = AudioObjectGetPropertyDataSize(deviceID, &address, 0, nil, &size)
    guard sizeStatus == noErr, size > 0 else {
        return 0
    }

    let raw = UnsafeMutableRawPointer.allocate(
        byteCount: Int(size),
        alignment: MemoryLayout<AudioBufferList>.alignment
    )
    defer { raw.deallocate() }
    let status = AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, raw)
    guard status == noErr else {
        return 0
    }

    let buffers = UnsafeMutableAudioBufferListPointer(raw.assumingMemoryBound(to: AudioBufferList.self))
    return buffers.reduce(0) { $0 + Int($1.mNumberChannels) }
}
