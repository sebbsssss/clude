String formatCost(double cost) {
  if (cost == 0) return 'Free';
  if (cost < 0.001) return '\$${cost.toStringAsFixed(5)}';
  return '\$${cost.toStringAsFixed(4)}';
}
