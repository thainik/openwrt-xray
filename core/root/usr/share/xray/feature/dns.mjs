"use strict";

import { lsdir } from "fs";
import { fake_dns_domains } from "./fake_dns.mjs";

const fallback_fast_dns = "223.5.5.5:53";
const fallback_secure_dns = "8.8.8.8:53";
const fallback_default_dns = "1.1.1.1:53";
const share_dir = lsdir("/usr/share/xray");
const geosite_existence = index(share_dir, "geosite.dat") > 0;

function split_ipv4_host_port(val, port_default) {
    const result = match(val, /([0-9\.]+):([0-9]+)/);
    if (result == null) {
        return {
            address: val,
            port: int(port_default)
        };
    }

    return {
        address: result[1],
        port: int(result[2])
    };
}

function domain_rules(proxy, k) {
    if (proxy[k] == null) {
        return [];
    }
    return filter(proxy[k], function (x) {
        if (substr(x, 0, 8) == "geosite:") {
            return geosite_existence;
        }
        return true;
    });
}

export function secure_domain_rules(proxy) {
    return domain_rules(proxy, "forwarded_domain_rules");
};

export function fast_domain_rules(proxy) {
    return domain_rules(proxy, "bypassed_domain_rules");
};

export function blocked_domain_rules(proxy) {
    return domain_rules(proxy, "blocked_domain_rules");
};

export function dns_server_inbounds(proxy) {
    let result = [];
    const dns_port = int(proxy["dns_port"] || 5300);
    const dns_count = int(proxy["dns_count"] || 3);
    const default_dns = split_ipv4_host_port(proxy["default_dns"] || fallback_default_dns, 53);
    for (let i = dns_port; i <= dns_port + dns_count; i++) {
        push(result, {
            port: i,
            protocol: "dokodemo-door",
            tag: sprintf("dns_server_inbound:%d", i),
            settings: {
                address: default_dns["address"],
                port: default_dns["port"],
                network: "tcp,udp"
            }
        });
    }
    return result;
};

export function dns_server_tags(proxy) {
    let result = [];
    const dns_port = int(proxy["dns_port"] || 5300);
    const dns_count = int(proxy["dns_count"] || 3);
    for (let i = dns_port; i <= dns_port + dns_count; i++) {
        push(result, sprintf("dns_server_inbound:%d", i));
    }
    return result;
};

export function dns_server_outbound() {
    return {
        protocol: "dns",
        settings: {
            nonIPQuery: "skip"
        },
        streamSettings: {
            sockopt: {
                mark: 254
            }
        },
        tag: "dns_server_outbound"
    };
};

export function dns_conf(proxy, config, manual_tproxy, fakedns) {
    const fast_dns_object = split_ipv4_host_port(proxy["fast_dns"] || fallback_fast_dns, 53);
    const default_dns_object = split_ipv4_host_port(proxy["default_dns"] || fallback_default_dns, 53);

    let domain_names_set = {};
    let domain_extra_options = {};

    for (let server in filter(values(config), i => i[".type"] == "servers")) {
        if (iptoarr(server["server"])) {
            continue;
        }
        if (server["domain_resolve_dns"]) {
            domain_extra_options[server["server"]] = server["domain_resolve_dns"];
        } else {
            domain_names_set[`domain:${server["server"]}`] = true;
        }
    }

    let servers = [
        ...fake_dns_domains(fakedns),
        ...map(keys(domain_extra_options), function (k) {
            const i = split_ipv4_host_port(domain_extra_options[k]);
            i["domains"] = [`domain:${k}`];
            i["skipFallback"] = true;
            return i;
        }),
        default_dns_object,
        {
            address: fast_dns_object["address"],
            port: fast_dns_object["port"],
            domains: [...keys(domain_names_set), ...fast_domain_rules(proxy)],
            skipFallback: true,
        },
    ];

    if (length(secure_domain_rules(proxy)) > 0) {
        const secure_dns_object = split_ipv4_host_port(proxy["secure_dns"] || fallback_secure_dns, 53);
        push(servers, {
            address: secure_dns_object["address"],
            port: secure_dns_object["port"],
            domains: secure_domain_rules(proxy),
        });
    }

    let hosts = {};
    if (length(blocked_domain_rules(proxy)) > 0) {
        for (let rule in (blocked_domain_rules(proxy))) {
            hosts[rule] = ["127.127.127.127", "100::6c62:636f:656b:2164"]; // blocked!
        }
    }

    for (let v in manual_tproxy) {
        if (v.domain_names != null) {
            for (let d in v.domain_names) {
                hosts[d] = [v.source_addr];
            }
        }
    }

    return {
        hosts: hosts,
        servers: servers,
        tag: "dns_conf_inbound",
        queryStrategy: "UseIP"
    };
};
