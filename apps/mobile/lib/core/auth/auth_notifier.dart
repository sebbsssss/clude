import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../config/env.dart';
import '../../features/byok/byok_provider.dart';
import '../storage/secure_storage_provider.dart';
import 'auth_state.dart';

class AuthNotifier extends StateNotifier<AuthState> {
  AuthNotifier(this._ref) : super(const AuthState());

  final Ref _ref;

  /// Restore session from secure storage on app launch.
  /// Optimistic — does not re-validate the key (matches web behaviour).
  Future<void> restoreSession() async {
    final storage = _ref.read(secureStorageProvider);
    final key = await storage.getCortexApiKey();
    if (key == null) return;

    final wallet = await storage.getWalletAddress();
    state = AuthState(
      isAuthenticated: true,
      cortexKey: key,
      walletAddress: wallet,
      authMode: wallet != null ? AuthMode.wallet : AuthMode.apiKey,
    );
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

  /// Login with wallet credentials (used by spec 007).
  Future<void> loginWithWallet(String key, String wallet) async {
    final storage = _ref.read(secureStorageProvider);
    await storage.setCortexApiKey(key);
    await storage.setWalletAddress(wallet);

    state = AuthState(
      isAuthenticated: true,
      cortexKey: key,
      walletAddress: wallet,
      authMode: AuthMode.wallet,
    );
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
