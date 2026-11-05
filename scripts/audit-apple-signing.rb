# frozen_string_literal: true
# Read-only inventory of Apple Distribution certificates.
# Does not revoke, create, import or export a signing certificate.
require "base64"
require "spaceship"

def required_env(name)
  value = ENV[name].to_s.strip
  abort("Missing configured secret #{name}") if value.empty?
  value
end

key_text = required_env("ASC_KEY_CONTENT")
key_text = Base64.decode64(key_text) unless key_text.include?("BEGIN PRIVATE KEY")
abort("Invalid API key format") unless key_text.include?("BEGIN PRIVATE KEY")

token = Spaceship::ConnectAPI::Token.create(
  key_id: required_env("ASC_KEY_ID"),
  issuer_id: required_env("ASC_ISSUER_ID"),
  key: key_text,
  duration: 600
)
Spaceship::ConnectAPI.token = token

certs = Spaceship::ConnectAPI::Certificate.all.select do |cert|
  %w[DISTRIBUTION IOS_DISTRIBUTION].include?(cert.certificate_type.to_s)
end

puts "APPLE DISTRIBUTION CERTIFICATES: #{certs.length}"
certs.each_with_index do |cert, idx|
  label = (cert.respond_to?(:display_name) ? cert.display_name : nil).to_s
  label = (cert.respond_to?(:name) ? cert.name : nil).to_s if label.empty?
  expiry = cert.respond_to?(:expiration_date) ? cert.expiration_date.to_s : "unknown"
  puts "#{idx + 1}. certificate ID=#{cert.id} type=#{cert.certificate_type} name=#{label.inspect} expires=#{expiry}"
end

# Only ACTIVE profiles are currently usable. Query the actual certificate
# relationship for each rather than assuming a certificate belongs to Wavo
# because the profile name contains Wavo.
begin
  profiles = Spaceship::ConnectAPI::Profile.all
  active = profiles.select { |profile| profile.profile_state.to_s == "ACTIVE" }
  puts "PROVISIONING PROFILES: #{profiles.length} total; #{active.length} active"
  used_ids = []
  unknown_links = 0
  active.each do |profile|
    name = profile.name.to_s
    begin
      linked = profile.fetch_all_certificates
      ids = linked.map(&:id)
      used_ids.concat(ids)
      puts "ACTIVE PROFILE #{name.inspect} => certificate IDs: #{ids.join(', ')}"
      unknown_links += 1 if ids.empty?
    rescue StandardError => e
      unknown_links += 1
      puts "ACTIVE PROFILE #{name.inspect} => certificate links UNAVAILABLE (#{e.class})"
    end
  end
  used_ids.uniq!
  puts "CERTIFICATES LINKED FROM ACTIVE PROFILES: #{used_ids.join(', ')}"
  candidates = certs.map(&:id) - used_ids
  if unknown_links > 0
    puts "NO DELETION RECOMMENDATION: #{unknown_links} active profile(s) have unverifiable certificate links."
  else
    puts "CANDIDATES WITH NO ACTIVE PROFILE LINKS: #{candidates.join(', ')}"
    puts "Caution: An unlinked certificate could still be needed for other future builds or private-key reuse."
  end
rescue StandardError => e
  puts "Provisioning-profile dependency inventory unavailable (#{e.class}); DO NOT REVOKE CERTIFICATES."
end

puts "AUDIT COMPLETE: No changes to certificates, profiles, App Store or TestFlight."
