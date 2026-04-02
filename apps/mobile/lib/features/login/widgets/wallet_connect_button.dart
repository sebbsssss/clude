import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/auth/auth_provider.dart';
import '../../../core/auth/wallet_auth_service.dart';

class WalletConnectButton extends ConsumerStatefulWidget {
  const WalletConnectButton({super.key});

  @override
  ConsumerState<WalletConnectButton> createState() =>
      _WalletConnectButtonState();
}

class _WalletConnectButtonState extends ConsumerState<WalletConnectButton> {
  WalletAuthService? _service;
  bool _isLoading = false;

  @override
  void dispose() {
    _service?.cancel();
    super.dispose();
  }

  Future<void> _connectWallet() async {
    if (_isLoading) return;

    setState(() => _isLoading = true);

    try {
      _service = WalletAuthService();
      final result = await _service!.connectAndSign();

      if (!mounted) return;

      await ref
          .read(authNotifierProvider.notifier)
          .loginWithWallet(result.apiKey, result.wallet);

      if (mounted) context.go('/chat');
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString())),
        );
      }
    } finally {
      _service = null;
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 48,
      child: OutlinedButton(
        onPressed: _isLoading ? null : _connectWallet,
        style: OutlinedButton.styleFrom(
          side: BorderSide(
            color: Theme.of(context).colorScheme.outline,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
          ),
        ),
        child: _isLoading
            ? const SizedBox(
                height: 20,
                width: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.account_balance_wallet_outlined, size: 20),
                  SizedBox(width: 8),
                  Text('Connect Wallet'),
                ],
              ),
      ),
    );
  }
}
