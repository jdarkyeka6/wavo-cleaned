import UIKit
import Capacitor
import PushKit
import CallKit

@objc(WavoCallKitPlugin)
public class WavoCallKitPlugin: CAPPlugin, CAPBridgedPlugin {
    public static let shared = WavoCallKitPlugin()

    public let identifier = "WavoCallKitPlugin"
    public let jsName = "WavoCallKit"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumePendingAction", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endCall", returnType: CAPPluginReturnPromise)
    ]

    private var appDelegate: AppDelegate? {
        UIApplication.shared.delegate as? AppDelegate
    }

    @objc func getState(_ call: CAPPluginCall) {
        var result: [String: Any] = [:]
        if let token = appDelegate?.voipDeviceToken {
            result["voipToken"] = token
        }
        if let pending = appDelegate?.pendingCallKitAction {
            result["pendingAction"] = pending
        }
        call.resolve(result)
    }

    @objc func consumePendingAction(_ call: CAPPluginCall) {
        let pending = appDelegate?.consumePendingCallKitAction()
        if let pending {
            call.resolve(["action": pending])
        } else {
            call.resolve(["action": NSNull()])
        }
    }

    @objc func endCall(_ call: CAPPluginCall) {
        guard let callId = call.getString("callId"), !callId.isEmpty else {
            call.reject("Missing callId")
            return
        }
        appDelegate?.requestEndCallFromWeb(callId: callId)
        call.resolve()
    }

    func publishCallAction(_ action: [String: Any]) {
        notifyListeners("callAction", data: action)
    }

    func publishVoipToken(_ token: String) {
        notifyListeners("voipToken", data: ["token": token])
    }
}

@objc(WavoBridgeViewController)
class WavoBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(WavoCallKitPlugin.shared)
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, PKPushRegistryDelegate, CXProviderDelegate {

    var window: UIWindow?

    private var pushRegistry: PKPushRegistry?
    private var callProvider: CXProvider?
    private let callController = CXCallController()
    private var callMetadata: [UUID: [String: Any]] = [:]
    private var answeredCalls = Set<UUID>()
    private var webRequestedEnds = Set<UUID>()

    private let voipTokenDefaultsKey = "wavo_voip_device_token"
    private let pendingActionDefaultsKey = "wavo_callkit_pending_action"

    var voipDeviceToken: String? {
        UserDefaults.standard.string(forKey: voipTokenDefaultsKey)
    }

    var pendingCallKitAction: [String: Any]? {
        UserDefaults.standard.dictionary(forKey: pendingActionDefaultsKey)
    }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        configureCallKit()
        configurePushKit()
        return true
    }

    private func configureCallKit() {
        let configuration = CXProviderConfiguration(localizedName: "Wavo")
        configuration.supportsVideo = true
        configuration.maximumCallGroups = 1
        configuration.maximumCallsPerCallGroup = 1
        configuration.supportedHandleTypes = [.generic]

        let provider = CXProvider(configuration: configuration)
        provider.setDelegate(self, queue: nil)
        callProvider = provider
    }

    private func configurePushKit() {
        let registry = PKPushRegistry(queue: DispatchQueue.main)
        registry.delegate = self
        registry.desiredPushTypes = [.voIP]
        pushRegistry = registry
    }

    func applicationWillResignActive(_ application: UIApplication) {
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        if let pending = pendingCallKitAction {
            WavoCallKitPlugin.shared.publishCallAction(pending)
        }
        if let token = voipDeviceToken {
            WavoCallKitPlugin.shared.publishVoipToken(token)
        }
    }

    func applicationWillTerminate(_ application: UIApplication) {
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    // Standard APNs registration used by @capacitor/push-notifications.
    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(
            name: .capacitorDidRegisterForRemoteNotifications,
            object: deviceToken
        )
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(
            name: .capacitorDidFailToRegisterForRemoteNotifications,
            object: error
        )
    }

    // MARK: - PushKit

    func pushRegistry(_ registry: PKPushRegistry,
                      didUpdate pushCredentials: PKPushCredentials,
                      for type: PKPushType) {
        guard type == .voIP else { return }
        let token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
        UserDefaults.standard.set(token, forKey: voipTokenDefaultsKey)
        WavoCallKitPlugin.shared.publishVoipToken(token)
    }

    func pushRegistry(_ registry: PKPushRegistry,
                      didInvalidatePushTokenFor type: PKPushType) {
        guard type == .voIP else { return }
        UserDefaults.standard.removeObject(forKey: voipTokenDefaultsKey)
    }

    func pushRegistry(_ registry: PKPushRegistry,
                      didReceiveIncomingPushWith payload: PKPushPayload,
                      for type: PKPushType,
                      completion: @escaping () -> Void) {
        guard type == .voIP else {
            completion()
            return
        }
        handleVoipPayload(payload.dictionaryPayload, completion: completion)
    }

    private func handleVoipPayload(_ payload: [AnyHashable: Any], completion: @escaping () -> Void) {
        let event = (payload["event"] as? String) ?? "incoming"
        guard let callId = payload["callUUID"] as? String,
              let uuid = UUID(uuidString: callId) else {
            completion()
            return
        }

        if event == "end" {
            callProvider?.reportCall(with: uuid, endedAt: Date(), reason: .remoteEnded)
            cleanupCall(uuid)
            completion()
            return
        }

        let callerName = (payload["callerName"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let visibleName = (callerName?.isEmpty == false) ? callerName! : "Wavo caller"
        let hasVideo = (payload["hasVideo"] as? Bool) ?? true

        callMetadata[uuid] = [
            "callId": callId,
            "callerName": visibleName,
            "hasVideo": hasVideo
        ]

        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: visibleName)
        update.localizedCallerName = visibleName
        update.hasVideo = hasVideo
        update.supportsHolding = false
        update.supportsGrouping = false
        update.supportsUngrouping = false
        update.supportsDTMF = false

        callProvider?.reportNewIncomingCall(with: uuid, update: update) { [weak self] error in
            if error != nil {
                self?.cleanupCall(uuid)
            }
            completion()
        }
    }

    // MARK: - CallKit

    func providerDidReset(_ provider: CXProvider) {
        callMetadata.removeAll()
        answeredCalls.removeAll()
        webRequestedEnds.removeAll()
        UserDefaults.standard.removeObject(forKey: pendingActionDefaultsKey)
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        answeredCalls.insert(action.callUUID)
        publishAction(name: "answer", uuid: action.callUUID)
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        let fromWeb = webRequestedEnds.remove(action.callUUID) != nil
        let wasAnswered = answeredCalls.contains(action.callUUID)

        if !fromWeb {
            publishAction(name: wasAnswered ? "end" : "decline", uuid: action.callUUID)
        }

        cleanupCall(action.callUUID)
        action.fulfill()
    }

    private func publishAction(name: String, uuid: UUID) {
        var action: [String: Any] = callMetadata[uuid] ?? ["callId": uuid.uuidString.lowercased()]
        action["action"] = name
        action["callId"] = uuid.uuidString.lowercased()
        UserDefaults.standard.set(action, forKey: pendingActionDefaultsKey)
        WavoCallKitPlugin.shared.publishCallAction(action)
    }

    func consumePendingCallKitAction() -> [String: Any]? {
        let action = pendingCallKitAction
        UserDefaults.standard.removeObject(forKey: pendingActionDefaultsKey)
        return action
    }

    func requestEndCallFromWeb(callId: String) {
        guard let uuid = UUID(uuidString: callId) else { return }
        webRequestedEnds.insert(uuid)

        let end = CXEndCallAction(call: uuid)
        let transaction = CXTransaction(action: end)
        callController.request(transaction) { [weak self] error in
            guard error != nil else { return }
            self?.webRequestedEnds.remove(uuid)
            self?.callProvider?.reportCall(with: uuid, endedAt: Date(), reason: .remoteEnded)
            self?.cleanupCall(uuid)
        }
    }

    private func cleanupCall(_ uuid: UUID) {
        callMetadata.removeValue(forKey: uuid)
        answeredCalls.remove(uuid)
        webRequestedEnds.remove(uuid)
    }
}
