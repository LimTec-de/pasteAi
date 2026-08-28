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

    let languageValue = language.map { String(cString: $0) } ?? ""
    let deviceValue = deviceUID.map { String(cString: $0) } ?? ""
    do {
        try runBlocking {
            try await DictationSession.shared.start(
                levelCb: levelCb,
                ctx: ctx,
                language: languageValue,
                deviceUID: deviceValue
            )
        }
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

    guard let locale = await resolveSpeechLocale(language: "auto") else {
        return Availability(false, "notAvailable", "On-device speech recognition is not available on this Mac.")
    }

    let transcriber = SpeechTranscriber(locale: locale, preset: .transcription)
    do {
        if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
            Task {
                try? await request.downloadAndInstall()
            }
            return Availability(false, "assetsNotReady", "macOS is still installing on-device speech recognition.")
        }
    } catch {
        return Availability(false, "notAvailable", "On-device speech recognition is not available on this Mac.")
    }

    return Availability(true, "available", "")
#else
    return Availability(false, "osTooOld", "Requires macOS 26 or later.")
#endif
}

@available(macOS 26.0, *)
private func resolveSpeechLocale(language: String) async -> Locale? {
#if canImport(Speech)
    let trimmed = language.trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmed.isEmpty && trimmed != "auto" {
        return await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: trimmed))
    }
    if let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale.current) {
        return locale
    }
    if let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: "en_US")) {
        return locale
    }
    return await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: "de_DE"))
#else
    return nil
#endif
}

@available(macOS 26.0, *)
private final class DictationSession: @unchecked Sendable {
    static let shared = DictationSession()

    private let lock = NSLock()
    private var engine: AVAudioEngine?
    private var transcriber: SpeechTranscriber?
    private var analyzer: SpeechAnalyzer?
    private var inputBuilder: AsyncStream<AnalyzerInput>.Continuation?
    private var resultsTask: Task<Void, Never>?
    private var reservedLocale: Locale?
    private var converter: AVAudioConverter?
    private var finalParts: [String] = []
    private var volatile = ""
    private var levelCb: PasteAILevelCallback?
    private var levelCtx: UnsafeMutableRawPointer?
    private var running = false

    func start(
        levelCb: PasteAILevelCallback?,
        ctx: UnsafeMutableRawPointer?,
        language: String,
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
        let specifiedLanguage = {
            let trimmed = language.trimmingCharacters(in: .whitespacesAndNewlines)
            return !trimmed.isEmpty && trimmed != "auto"
        }()
        guard let locale = await resolveSpeechLocale(language: language) else {
            if specifiedLanguage {
                throw NSError(domain: "pasteAI", code: 3, userInfo: [NSLocalizedDescriptionKey: "On-device speech recognition does not support this language."])
            }
            throw NSError(domain: "pasteAI", code: 3, userInfo: [NSLocalizedDescriptionKey: "On-device speech recognition is not available on this Mac."])
        }

        try await AssetInventory.reserve(locale: locale)
        let transcriber = SpeechTranscriber(locale: locale, preset: .transcription)
        if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
            try await request.downloadAndInstall()
        }

        guard let audioFormat = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) else {
            await AssetInventory.release(reservedLocale: locale)
            throw NSError(domain: "pasteAI", code: 3, userInfo: [NSLocalizedDescriptionKey: "On-device speech recognition is not available on this Mac."])
        }

        let analyzer = SpeechAnalyzer(modules: [transcriber])
        let (inputSequence, inputBuilder) = AsyncStream.makeStream(of: AnalyzerInput.self)
        try await analyzer.start(inputSequence: inputSequence)

        let engine = AVAudioEngine()
        let input = engine.inputNode
        if !deviceUID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            try setEngineInputDevice(engine, uid: deviceUID)
        }
        let hwFormat = input.outputFormat(forBus: 0)
        let converter = AVAudioConverter(from: hwFormat, to: audioFormat)

        lock.lock()
        self.levelCb = levelCb
        self.levelCtx = ctx
        self.engine = engine
        self.transcriber = transcriber
        self.analyzer = analyzer
        self.inputBuilder = inputBuilder
        self.reservedLocale = locale
        self.converter = converter
        self.finalParts = []
        self.volatile = ""
        self.running = true
        lock.unlock()

        resultsTask = Task { [weak self] in
            guard let self else { return }
            do {
                for try await result in transcriber.results {
                    let piece = String(result.text.characters)
                    self.lock.lock()
                    if result.isFinal {
                        self.finalParts.append(piece)
                        self.volatile = ""
                    } else {
                        self.volatile = piece
                    }
                    self.lock.unlock()
                }
            } catch {
                // Result stream ends when the analyzer finishes or fails.
            }
        }

        input.installTap(onBus: 0, bufferSize: 1024, format: hwFormat) { [weak self] buffer, _ in
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
        let locale = self.reservedLocale
        let wasRunning = running
        self.engine = nil
        self.analyzer = nil
        self.inputBuilder = nil
        self.resultsTask = nil
        self.transcriber = nil
        self.converter = nil
        self.reservedLocale = nil
        self.levelCb = nil
        self.levelCtx = nil
        self.running = false
        let parts = finalParts
        let volatile = self.volatile
        finalParts = []
        self.volatile = ""
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

        if let locale {
            await AssetInventory.release(reservedLocale: locale)
        }

        let combined = (parts + [volatile]).filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        return combined.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
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
        if buffer.format.sampleRate == format.sampleRate
            && buffer.format.channelCount == format.channelCount
            && buffer.format.commonFormat == format.commonFormat {
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
