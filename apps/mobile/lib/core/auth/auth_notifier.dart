import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:privy_flutter/privy_flutter.dart' as privy_sdk;

import '../../config/env.dart';
import '../../features/byok/byok_provider.dart';
import '../api/api_client_provider.dart';
import '../storage/secure_storage_provider.dart';
import 'auth_state.dart';
import 'privy_provider.dart';
import 'wallet_auth_service.dart';

class AuthNotifier extends StateNotifier<AuthState> {
  AuthNotifier(this._ref) : super(const AuthState());

  final Ref _ref;

  /// Restore session from secure storage on app launch.
  /// Waits for Privy SDK readiness, then checks stored keys.
  Future<void> restoreSession() async {
    // Wait for Privy SDK to be ready
    final privy = _ref.read(privyProvider);
    await privy.getAuthState();

    final storage = _ref.read(secureStorageProvider);
    final key = await storage.getCortexApiKey();
    if (key == null) return;

    final wallet = await storage.getWalletAddress();
    state = AuthState(
      isAuthenticated: true,
      cortexKey: key,
      walletAddress: wallet,
      authMode: wallet != null ? AuthMode.privy : AuthMode.apiKey,
    );
  }

  /// Authenticate via Privy SIWS wallet flow.
  /// Opens Phantom, signs SIWS message, gets Privy JWT, calls auto-register.
  Future<bool> loginWithPrivy({WalletAuthService? service}) async {
    state = state.copyWith(isLoading: true, error: null);
    try {
      service ??= WalletAuthService(
        _ref.read(privyProvider),
        _ref.read(apiClientProvider),
      );
      final result = await service.connectAndSign();
      await loginWithWallet(result.apiKey, result.wallet);
      return true;
    } catch (e) {
      state = state.copyWith(
        isLoading: false,
        error: e.toString(),
      );
      return false;
    }
  }

  /// Validate and login with a `clk_*` API key.
  Future<bool> loginWithApiKey(String key) async {
    if (!key.startsWith('clk_')) {
      state = state.copyWith(
        error: 'Invalid API key. Check your key and try again.',
      );
      return false;
    }

    state = state.copyWith(isLoading: true, error: null);

    final valid = await _validateKey(key);
    if (!valid) {
      state = state.copyWith(
        isLoading: false,
        error: 'Invalid API key. Check your key and try again.',
      );
      return false;
    }

    final storage = _ref.read(secureStorageProvider);
    await storage.setCortexApiKey(key);

    state = AuthState(
      isAuthenticated: true,
      cortexKey: key,
      authMode: AuthMode.apiKey,
    );
    return true;
  }

  /// Login with wallet credentials (called after Privy SIWS flow).
  Future<void> loginWithWallet(String key, String wallet) async {
    final storage = _ref.read(secureStorageProvider);
    await storage.setCortexApiKey(key);
    await storage.setWalletAddress(wallet);

    state = AuthState(
      isAuthenticated: true,
      cortexKey: key,
      walletAddress: wallet,
      authMode: AuthMode.privy,
    );
  }

  /// Send a one-time passcode to [email] via Privy.
  /// Returns true on success; sets error state on failure.
  Future<bool> sendEmailCode(String email) async {
    state = state.copyWith(isLoading: true, error: null);
    try {
      final privy = _ref.read(privyProvider);
      final result = await privy.email.sendCode(email);
      state = state.copyWith(isLoading: false);
      return switch (result) {
        privy_sdk.Success() => true,
        privy_sdk.Failure(error: final e) => throw Exception(e.message),
      };
    } catch (e) {
      state = state.copyWith(isLoading: false, error: e.toString());
      return false;
    }
  }

  /// Verify the OTP [code] sent to [email] and complete authentication.
  /// Returns true on success; sets error state on failure.
  Future<bool> loginWithEmailCode({
    required String email,
    required String code,
  }) async {
    state = state.copyWith(isLoading: true, error: null);
    try {
      final privy = _ref.read(privyProvider);
      final loginResult = await privy.email.loginWithCode(
        email: email,
        code: code,
      );
      final user = switch (loginResult) {
        privy_sdk.Success(value: final u) => u,
        privy_sdk.Failure(error: final e) =>
          throw Exception(e.message),
      };

      final tokenResult = await user.getAccessToken();
      final jwt = switch (tokenResult) {
        privy_sdk.Success(value: final t) => t,
        privy_sdk.Failure(error: final e) =>
          throw Exception(e.message),
      };

      final registered =
          await _ref.read(apiClientProvider).autoRegister(jwt);

      final storage = _ref.read(secureStorageProvider);
      await storage.setCortexApiKey(registered.apiKey);

      state = AuthState(
        isAuthenticated: true,
        cortexKey: registered.apiKey,
        authMode: AuthMode.privy,
      );
      return true;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: e.toString());
      return false;
    }
  }

  /// Continue without authentication.
  void continueAsGuest() {
    state = const AuthState(isGuest: true);
  }

  /// Enter demo mode with fake credentials (no server needed).
  /// To remove: delete this method + the "Try Demo" button in login_screen.dart.
  void loginAsDemo() {
    state = const AuthState(
      isAuthenticated: true,
      cortexKey: 'clk_demo_mode',
      authMode: AuthMode.apiKey,
    );
  }

  /// Clear all auth state and stored credentials.
  Future<void> logout() async {
    // Clear Privy session if active
    final privy = _ref.read(privyProvider);
    final authState = privy.currentAuthState;
    if (authState is privy_sdk.Authenticated) {
      await privy.logout();
    }

    await _ref.read(secureStorageProvider).clearAll();
    await _ref.read(byokKeysNotifierProvider.notifier).clearAll();
    state = const AuthState();
  }

  /// Alias for logout — called by auth interceptor on 401.
  void clearAuth() => logout();

  /// Validate key against the API. Returns false on any error.
  Future<bool> _validateKey(String key) async {
    try {
      final dio = Dio();
      final res = await dio.get(
        '${Env.apiBaseUrl}/api/cortex/stats',
        options: Options(
          headers: {'Authorization': 'Bearer $key'},
          validateStatus: (status) => true,
        ),
      );
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }
}
